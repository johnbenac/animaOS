# ANIMA Memory

This directory is ANIMA's long-term memory store. It uses markdown files with YAML frontmatter as a human-readable, git-versioned knowledge base.

## Structure

```
memory/
├── user/           # Per-user profiles, preferences, goals
│   └── {userId}/
│       ├── profile.md
│       ├── preferences.md
│       └── goals.md
├── knowledge/      # Accumulated facts and knowledge
│   └── {userId}/
│       └── {topic}.md
├── relationships/  # People and entities the user mentions
│   └── {userId}/
│       └── {person}.md
├── journal/        # Daily session summaries
│   └── {userId}/
│       └── YYYY-MM-DD.md
└── README.md
```

## File Format

Each memory file uses YAML frontmatter for metadata:

```markdown
---
category: preference
tags: [music, taste]
created: 2026-02-13T14:30:00Z
updated: 2026-02-13T14:30:00Z
source: conversation
---

# Music Preferences

- Likes lo-fi hip hop for coding
- Favorite artist: Nujabes
```

## Design Principles

- **Human-readable**: You can browse, edit, or delete any memory in your file explorer
- **Git-friendly**: Version your memory with diffs, rollbacks, and branches
- **Portable**: No database dependency — just files
- **Transparent**: See exactly what your AI knows about you
