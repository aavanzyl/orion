/**
 * A curated catalog of skills Orion recommends. These are not installed by
 * default; users browse this list and install any of them with one click. Each
 * entry carries the GitHub coordinates the installer needs (source repository
 * and path to the skill's `SKILL.md` or directory).
 *
 * Keep this list conservative and high-signal — every entry should point at a
 * reputable, publicly reviewable source repository.
 */

import type { RecommendedSkill } from '@orion/models';

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  // ── Development & Technical ───────────────────────────────────────────
  {
    name: 'webapp-testing',
    description:
      'Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/webapp-testing',
    tags: ['implement', 'review'],
    author: 'Anthropic',
  },
  {
    name: 'mcp-builder',
    description:
      'Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/mcp-builder',
    tags: ['implement'],
    author: 'Anthropic',
  },
  {
    name: 'frontend-design',
    description:
      'Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, layout, and making choices that avoid templated defaults.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/frontend-design',
    tags: ['implement'],
    author: 'Anthropic',
  },
  {
    name: 'web-artifacts-builder',
    description:
      'Suite of tools for creating elaborate, multi-component HTML artifacts using React, Tailwind CSS, and shadcn/ui. Use for complex artifacts requiring state management, routing, or shadcn/ui components.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/web-artifacts-builder',
    tags: ['implement'],
    author: 'Anthropic',
  },
  {
    name: 'skill-creator',
    description:
      'Guide for creating effective skills that extend Claude\'s capabilities with specialized knowledge, workflows, and tool integrations. Use when building or improving skills.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/skill-creator',
    tags: ['plan'],
    author: 'Anthropic',
  },
  {
    name: 'claude-api',
    description:
      'Reference for building applications on top of the Claude API, including client instantiation, advanced features, prompt engineering, and common integration patterns.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/claude-api',
    tags: ['implement'],
    author: 'Anthropic',
  },
  // ── Document Skills ───────────────────────────────────────────────────
  {
    name: 'pdf',
    description:
      'Use when reading, filling, splitting, merging, or extracting content from PDF files. Provides tooling and guidance for reliable PDF manipulation.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/pdf',
    tags: ['implement'],
    author: 'Anthropic',
  },
  {
    name: 'docx',
    description:
      'Use when creating or editing Microsoft Word (.docx) documents while preserving formatting, styles, and structure.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/docx',
    tags: ['implement'],
    author: 'Anthropic',
  },
  {
    name: 'xlsx',
    description:
      'Use when creating or editing Microsoft Excel (.xlsx) spreadsheets, including formulas, formatting, and multiple sheets.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/xlsx',
    tags: ['implement'],
    author: 'Anthropic',
  },
  {
    name: 'pptx',
    description:
      'Use when creating or editing Microsoft PowerPoint (.pptx) presentations with layouts, styles, and speaker notes.',
    source: 'https://github.com/anthropics/skills',
    skillPath: 'skills/pptx',
    tags: ['implement'],
    author: 'Anthropic',
  },
];

export const RECOMMENDED_SKILLS_BY_NAME: ReadonlyMap<string, RecommendedSkill> = new Map(
  RECOMMENDED_SKILLS.map((s) => [s.name, s]),
);
