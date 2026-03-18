# Incident Investigator — Project Summary

A real-time multiplayer pharmacy safety investigation game built for **PHTE 205** at Okanagan College. Students join from their phones, investigate a real pharmacy incident by chatting with AI-powered characters, then submit their findings — all while the instructor watches the investigation unfold on a projected dashboard.

## The Incident

A patient's wife called to refill **Novolin GE 30/70** (intermediate-acting insulin) — 5 boxes. A pharmacy tech student grabbed 5 boxes from the fridge, but **one box was actually Novo-Rapid** (rapid-acting insulin). The student scanned the barcode on the top box 5 times instead of scanning each box individually. The pharmacist only checked the top box and signed off. The patient injected the wrong insulin the next morning and went into **severe hypoglycemia** (blood glucose 2.5 mmol/L) — ending up in the ER on IV dextrose.

## How It Works

### Game Flow
```
LOBBY → Students join with a 4-letter room code on their phones
  ↓
INVESTIGATION → Each student gets a unique AI character scene to interrogate
  ↓
SUBMIT FINDINGS → "What went wrong?" + "How would you fix it?"
  ↓
"ARE YOU SURE?" → Gamble mechanic: ask one more question (risky) or submit final
  ↓
ASSEMBLY → Dashboard reveals the full incident tree with everyone's scores
```

### Two Interfaces
- **Player view** (`/`) — Mobile-first. Students join, chat with AI characters, and submit findings from their phones.
- **Dashboard** (`/dashboard.html`) — Desktop/projector. The instructor sees the investigation tree, live activity feed, timer, and final assembly with scores.

### 14 Investigation Scenes
Each student is randomly assigned one scene. Scenes are distributed across **5 root causes**:

| Root Cause | Scenes |
|---|---|
| **1. Unclear Role Definition** | Student Interview (Kayla), Orientation Binder, Pharmacy Manager (Greg) |
| **2. Look-Alike Storage** | The Fridge, Stock Clerk (Dina) |
| **3. Look-Alike Branding** | Evidence Table, Manufacturer Rep (Sandra), Incident Report |
| **4. Barcode Safeguard Defeated** | Barcode Scanner Log, Software Vendor (Mike), ER Physician (Dr. Okafor) |
| **5. Limited Safeguard Understanding** | Checking Pharmacist (Dr. Chen), Training Records, Patient's Wife (Margaret) |

Each scene has a fully written AI character with backstory, knowledge, and rules for staying in character. The AI never reveals the root cause directly — students must discover it through good questioning.

### AI Scoring (1–3 Scale)
When students submit, the AI evaluates:
- **Root cause accuracy** — did they find the real systemic issue?
- **Fix quality** — is their proposed fix system-level or just "more training"?
- **Leverage level** — AI auto-assigns high/medium/low based on the Hierarchy of Effectiveness

Score mapping:
- **3** = Nailed the root cause AND proposed a solid fix
- **2** = Got the general idea but fix is weak or root cause is vague
- **1** = Missed the mark or only surface-level understanding

Students never see their score — just "Investigation Complete." Scores are revealed on the projector during assembly (star ratings).

### The Gamble Mechanic
After submitting, students see an "Are You Sure?" screen:
- **"I'm Sure — Submit"** → Final submission, AI scores it
- **"One More Question"** → Returns to chat for exactly 1 more message, then forced to resubmit. Warning: "A bad question could hurt your score." This creates tension — do you trust your answer or risk it?

## Tech Stack

| Component | Technology |
|---|---|
| Server | Node.js + Express |
| Real-time | Socket.IO |
| AI | Google Gemini API (`@google/genai` SDK, `gemini-2.0-flash`) |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Font | Sora (Google Fonts) |

### File Structure
```
server.js              — Express + Socket.IO server, game logic
game/
  ai.js                — AI session management, chat, scoring evaluation
  scenes.js            — 14 scene definitions with character prompts
  state.js             — Room/player state management
public/
  index.html           — Player screens (join, lobby, investigation, complete, assembly)
  dashboard.html       — Instructor dashboard (lobby, investigation tree, assembly)
  css/
    common.css         — Design system (colors, typography, glass effects, animations)
    player.css         — Player-specific styles
    dashboard.css      — Dashboard-specific styles
  js/
    player.js          — Player client logic (join, chat, submission state machine)
    dashboard.js       — Dashboard client logic (tree, activity feed, timer, assembly)
.env                   — GEMINI_API_KEY and GEMINI_MODEL
```

## Visual Design

**"Liquid glass" aesthetic** — white/translucent glassmorphism with animated gradient mesh orbs in the background. Keeps the elegance but avoids looking like an Apple product page.

Key design elements:
- **5 animated mesh orbs** — Sky blue, peach, pink, lavender, mint. Each flows and pulses independently with `translate3d` + scale + rotate animations.
- **Glass cards** — `backdrop-filter: blur(40px) saturate(1.8)` with semi-transparent white backgrounds and inset highlight shadows.
- **Gradient text** — Titles use a dark-to-cyan-to-teal gradient with a slow shimmer animation.
- **Pill-shaped buttons/inputs** — `border-radius: 999px` for a softer, more game-like feel.
- **Individual code boxes** — 4 separate input boxes for the room code (auto-advance on type, paste support).
- **Floating card headers** — Scene header and investigation header are floating glass cards, not full-width bars.
- **Asymmetric chat bubbles** — User messages have a flat bottom-right corner, assistant messages have a flat bottom-left corner.

## Running It

```bash
npm install
# Set GEMINI_API_KEY in .env
node server.js
# Player: http://localhost:3000
# Dashboard: http://localhost:3000/dashboard.html
```

## What's Left

- **End-to-end testing** — Full game flow with multiple players
- **AI jailbreak prevention** — Tightening character prompts so students can't trick the AI into revealing answers
- **Assembly debrief** — AI narrates through findings during the assembly phase
- **Deploy to Render.com** — For classroom use on the college network
