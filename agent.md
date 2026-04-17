# KET English — Agent Guidelines

## Project Summary

This repository contains two lightweight web-based learning tools for KET (Key English Test) exam preparation, targeting primary school families in China.

### System A: Vocabulary Rolling Review (vocab-review/)

A spaced-repetition vocabulary review and mistake-recycling system.

**Key Features:**
- Weekly word input (recognition words vs. spelling words)
- Automated daily review task generation using spaced intervals (Day 0/1/3/7/14/30)
- Three-tier mastery system: Red → Yellow → Green
- Wrong-word recycling with priority scheduling
- Parent dashboard with weekly statistics

**Daily Task Priority Order:**
1. Due red-tier words
2. Due yellow-tier words
3. Due spelling words
4. Historical wrong-word recycling
5. Green-tier spot checks

**Mastery Promotion Rules:**
| Type | Level | Promotion Condition | Review Interval |
|------|-------|---------------------|-----------------|
| Recognition | Red → Yellow | 2 consecutive correct | 1 day |
| Recognition | Yellow → Green | 3 consecutive correct | 3 days |
| Recognition | Green → Yellow/Red | 1 wrong / 2 consecutive wrong | 7-14 day spot check |
| Spelling | Red → Yellow | 2 consecutive correct | 1 day |
| Spelling | Yellow → Green | 3 consecutive correct | 2 days |
| Spelling | Green → Yellow/Red | 1 wrong / 2 consecutive wrong | 5-7 day review |

### System B: Listening Segment Player (listening-player/)

A sentence-level intensive listening player with difficult-sentence recycling.

**Key Features:**
- Import audio + transcript, auto-segment by silence/punctuation
- Manual segment correction (split, merge, drag boundaries)
- Per-sentence loop, variable speed (0.75x/0.85x/1.0x), linked playback
- Difficult sentence notebook with recycling priority
- Three modes: Intensive / Exam / Review

**Difficult Sentence Priority:**
1. Critical (recently failed repeatedly)
2. General (played many times)
3. Resolved (recently understood, low-frequency check)

---

## Technology Stack

| Layer | Choice |
|-------|--------|
| Frontend | HTML + Vanilla CSS + JavaScript (Web/PWA) |
| Styling | Vanilla CSS with modern aesthetics (gradients, micro-animations, dark theme support) |
| Storage | IndexedDB (local-first, cloud-sync ready) |
| Audio | Web Audio API / native Audio element |
| ASR | Whisper / third-party (optional, not required for V1.0) |

## Directory Layout

```
KET Engish/
├── claude.md                # Claude Code project guide (Chinese)
├── agent.md                 # General AI agent guide (English)
├── docs/                    # Requirements documents
│   ├── KET单词滚动复习软件需求书_V1.0.md
│   └── KET听力句段精听播放器需求书_V1.0.md
├── vocab-review/            # System A: Vocabulary Rolling Review
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── assets/
└── listening-player/        # System B: Listening Segment Player
    ├── index.html
    ├── css/
    ├── js/
    └── assets/
```

## Design Principles

1. **Child-friendly UI**: Large buttons, clear fonts, minimal navigation depth
2. **Visually polished**: Modern design language — rounded corners, soft gradients, micro-animations, child-appropriate color palette. NOT a bare-bones MVP.
3. **Local-first**: All data persisted locally via IndexedDB; no data loss on page refresh
4. **Chinese interface**: All UI copy in Simplified Chinese
5. **Mobile-first**: Prioritize phone/tablet layouts, desktop adapts responsively

## Data Models

### Vocabulary System
- `words` — word master (english, chinese, part_of_speech, word_type, week_no, ...)
- `word_progress` — learning progress (mastery_level, consecutive_correct, next_review_at, ...)
- `review_logs` — review history per attempt
- `weekly_batches` — week management
- `daily_tasks` — generated daily tasks

### Listening System
- `listening_sets` — test set master
- `audio_assets` — audio files
- `transcripts` — transcript text by part/question
- `segments` — sentence segments (start_time, end_time, text, status)
- `segment_logs` — training logs per segment
- `difficult_segments` — difficult sentence notebook

## V1.0 Scope

**In scope:** Core review/listening loops, wrong-word/sentence recycling, basic statistics, parent dashboard
**Out of scope:** AI explanation, speech scoring, social ranking, cloud sync, public content distribution

## Development Notes

- Each sub-system is a standalone SPA — no shared runtime dependency
- Use semantic HTML5 elements for accessibility
- Implement responsive design with CSS Grid/Flexbox
- Audio playback must support gapless looping and precise seek
- All interactive elements must have unique IDs for testing
- Prefer CSS custom properties for theming consistency

## Full Requirements

See `docs/` directory for complete requirement specifications.
