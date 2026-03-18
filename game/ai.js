const { GoogleGenAI } = require('@google/genai');

class AIManager {
  constructor(apiKey, model) {
    this.genai = new GoogleGenAI({ apiKey });
    this.model = model || 'gemini-2.0-flash';
    this.chatSessions = new Map(); // playerId -> { chat, scene }
  }

  async createSession(playerId, scene) {
    const chat = this.genai.chats.create({
      model: this.model,
      config: {
        systemInstruction: scene.systemPrompt + '\n\nIMPORTANT: Keep ALL responses to 2-3 sentences max. Be concise and conversational. Never write paragraphs. NEVER use em dashes or long dashes. Use commas, periods, or separate sentences instead.',
        maxOutputTokens: 150,
        temperature: 0.7,
      },
    });
    this.chatSessions.set(playerId, { chat, scene, currentMilestone: 0 });

    const initialChips = this.extractChips(scene.chips?.[0]?.questions);

    // RPG scenes: use scripted opening narration + dialogue
    if (scene.openingNarration) {
      const messages = [];
      messages.push({ text: scene.openingNarration, type: 'narration' });
      if (scene.openingDialogue) {
        // Seed the AI with context that the investigator just arrived
        chat.sendMessage({
          message: `[The investigator has entered your office. You greeted them with: "${scene.openingDialogue}", continue the conversation from here. Do NOT repeat this greeting.]`,
        }).catch(() => {});
        messages.push({ text: scene.openingDialogue, type: 'dialogue' });
      }
      return { messages, chips: initialChips, showTips: true };
    }

    // Legacy scenes: AI-generated intro
    try {
      const response = await chat.sendMessage({
        message: `[The investigator has just entered your scene. Set the atmosphere briefly and wait for their first question. Stay in character. Keep it to 2-3 sentences.]`,
      });
      return { messages: [{ text: response.text, type: 'dialogue' }], chips: initialChips, showTips: true };
    } catch (err) {
      console.error(`AI session init error for ${playerId}:`, err.message);
      return { messages: [{ text: this.getFallbackIntro(scene), type: 'dialogue' }], chips: initialChips, showTips: true };
    }
  }

  async sendMessage(playerId, userMessage) {
    const session = this.chatSessions.get(playerId);
    if (!session) throw new Error('No chat session for player');

    try {
      const response = await session.chat.sendMessage({ message: userMessage });
      const text = response.text;
      const { chips, narration } = this.advanceMilestone(playerId, text);
      return { text, chips, narration };
    } catch (err) {
      console.error(`AI message error for ${playerId}:`, err.message);
      return { text: this.getFallbackResponse(), chips: this.getCurrentChips(playerId), narration: null };
    }
  }

  // Check if the AI response triggers the next milestone, return current chips + narration
  advanceMilestone(playerId, responseText) {
    const session = this.chatSessions.get(playerId);
    if (!session || !session.scene.chips) return { chips: [], narration: null };

    const milestones = session.scene.chips;
    const startMilestone = session.currentMilestone || 0;
    let current = startMilestone;
    const lower = responseText.toLowerCase();

    // Track messages at current milestone for auto-advance fallback
    if (!session.msgsAtMilestone) session.msgsAtMilestone = 0;
    session.msgsAtMilestone++;

    let advancedTo = null;

    // Try to advance through milestones
    for (let next = current + 1; next < milestones.length; next++) {
      if (!milestones[next].triggers) continue;

      // Check keyword triggers
      const triggered = milestones[next].triggers.some(t => {
        const tLower = t.toLowerCase();
        if (tLower.includes(' ')) {
          return tLower.split(/\s+/).every(word => lower.includes(word));
        }
        return lower.includes(tLower);
      });

      const autoAdvance = session.msgsAtMilestone >= 2;

      if (triggered || autoAdvance) {
        session.currentMilestone = next;
        session.msgsAtMilestone = 0;
        advancedTo = next;
        current = next;
      } else {
        break;
      }
    }

    // Only return narration if we just advanced to a new milestone
    const narration = advancedTo !== null ? (milestones[advancedTo].narration || null) : null;

    return {
      chips: this.extractChips(milestones[current]?.questions),
      narration,
    };
  }

  getCurrentChips(playerId) {
    const session = this.chatSessions.get(playerId);
    if (!session || !session.scene.chips) return [];
    const current = session.currentMilestone || 0;
    return this.extractChips(session.scene.chips[current]?.questions);
  }

  // Normalize chips, handles both old format (string[]) and new RPG format (object[])
  extractChips(questions) {
    if (!questions || questions.length === 0) return [];
    // Old format: ['question text', ...]
    if (typeof questions[0] === 'string') {
      return questions.map(q => ({ text: q, type: 'talk' }));
    }
    // New format: [{ text, type, response? }, ...]
    return questions;
  }

  // Handle a narration chip (examine action), returns scripted response, no AI call
  handleNarrationChip(playerId, chipText) {
    const session = this.chatSessions.get(playerId);
    if (!session) return null;

    const milestones = session.scene.chips;
    const current = session.currentMilestone || 0;
    const milestone = milestones[current];
    if (!milestone || !milestone.questions) return null;

    const chip = milestone.questions.find(q =>
      typeof q === 'object' && q.type === 'examine' && q.text === chipText
    );
    return chip ? chip.response : null;
  }

  async evaluateSubmission(playerId, submission) {
    const session = this.chatSessions.get(playerId);
    if (!session) throw new Error('No chat session for player');

    const { scene } = session;
    const prompt = `You are scoring a pharmacy technician student's investigation findings. Score on a 1-3 scale.

SCENE: "${scene.title}"
TARGET ROOT CAUSE: ${scene.rootCauseLabel}
WHAT THEY SHOULD HAVE FOUND: ${scene.investigates}
IDEAL FIX: ${scene.idealFix}
CORRECT LEVERAGE LEVEL: ${scene.leverageLevel}

THE HIERARCHY OF EFFECTIVENESS:
- High leverage: Forcing functions & constraints, Automation/computerization
- Medium leverage: Standardization/simplification, Reminders/checklists/double checks
- Low leverage: Policies & procedures, Education & training

STUDENT SUBMISSION:
- What went wrong: ${submission.whatWentWrong}
- Proposed fix: ${submission.proposedFix}

SCORING GUIDE:
- 3 = Correctly identified the root cause AND proposed a reasonable system-level fix
- 2 = Got the general idea (partially correct root cause OR decent fix but not both strong)
- 1 = Missed the mark, surface-level understanding, wrong root cause, or fix is just "more training"

Also determine what leverage level their proposed fix falls under (high, medium, or low) based on the hierarchy above. This is YOUR assessment, not the student's.

Respond with ONLY valid JSON, no markdown formatting:
{
  "score": 1 or 2 or 3,
  "leverage": "high" or "medium" or "low",
  "root_cause_accurate": true or false,
  "fix_quality": "strong" or "partial" or "weak",
  "feedback": "2-3 sentences of constructive feedback for the class debrief. Be encouraging but honest. Focus on what they found well and what they could dig deeper on."
}`;

    try {
      const response = await this.genai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 400,
        },
      });

      let text = response.text.trim();
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(text);
    } catch (err) {
      console.error(`AI evaluation error for ${playerId}:`, err.message);
      return {
        score: 1,
        leverage: 'low',
        root_cause_accurate: false,
        fix_quality: 'weak',
        feedback: 'Unable to evaluate, submission will be reviewed manually.',
      };
    }
  }

  getFallbackIntro(scene) {
    return scene.setup + " Take a moment to look around and ask your first question.";
  }

  getFallbackResponse() {
    const fallbacks = [
      "Give me a moment to think about that... Could you rephrase your question?",
      "That's an interesting angle. What specifically would you like to know more about?",
      "Hmm, let me think... Why don't you try asking about something more specific?",
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  destroySession(playerId) {
    this.chatSessions.delete(playerId);
  }

  destroyAll() {
    this.chatSessions.clear();
  }
}

module.exports = { AIManager };
