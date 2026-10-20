import type { RoutineConfig, RoutineDraft } from '../shared/types'
import { parseConfig } from './routines'

// Rotinas prontas: o usuario escolhe uma e ja sai com prompt + agenda preenchidos, editaveis antes de salvar.
// Baixa a barreira de "montar o prompt do zero". Prompts em ingles (instrucao pro agente, como o resto do app).
export interface Recipe {
  id: string
  name: string
  description: string
  config: Partial<RoutineConfig>
  prompt: string
}

const WEEKDAYS_BIZ = ['mon', 'tue', 'wed', 'thu', 'fri'] as RoutineConfig['schedule']['days']

export const RECIPES: Recipe[] = [
  {
    id: 'review-open-prs',
    name: 'Review open PRs',
    description: 'Every morning, list open pull requests and leave a short review of each.',
    config: { schedule: { days: WEEKDAYS_BIZ, times: ['09:00'] }, permission_mode: 'dontAsk', allowed_tools: ['Bash(gh *)', 'Read', 'Grep'] },
    prompt: [
      'List the open pull requests in this repository (use the `gh` CLI).',
      'For each one, read the diff and write a concise review: what it does, risks, and whether it looks safe to merge.',
      'Output a single summary with one short paragraph per PR. Do not push or comment anything — just report.',
    ].join('\n'),
  },
  {
    id: 'summarize-commits',
    name: "Summarize last night's commits",
    description: 'Summarize the commits since yesterday so you start the day with the big picture.',
    config: { schedule: { days: WEEKDAYS_BIZ, times: ['08:30'] }, permission_mode: 'dontAsk', allowed_tools: ['Bash(git *)', 'Read'] },
    prompt: [
      'Show the git commits from the last 24 hours (git log --since="24 hours ago" with stats).',
      'Write a short digest: the main changes, grouped by area, and anything that looks risky or unfinished.',
      'Keep it to a few bullet points. Read-only: do not change anything.',
    ].join('\n'),
  },
  {
    id: 'check-ci',
    name: 'Check for broken CI',
    description: 'Check whether the latest CI run is failing and, if so, point at the likely cause.',
    config: { schedule: { days: WEEKDAYS_BIZ, times: ['09:15'] }, permission_mode: 'dontAsk', allowed_tools: ['Bash(gh *)', 'Read'] },
    prompt: [
      'Check the status of the most recent CI runs (gh run list / gh run view).',
      'If something is red, open the failing job logs and explain the likely cause in plain language.',
      'If everything is green, just say so. Do not re-run or change anything.',
    ].join('\n'),
  },
  {
    id: 'docs-drift',
    name: 'Find docs drift',
    description: 'Look for documentation that no longer matches the code and list what to update.',
    config: { schedule: { days: ['mon'] as RoutineConfig['schedule']['days'], times: ['10:00'] }, permission_mode: 'dontAsk', allowed_tools: ['Read', 'Grep', 'Bash(git *)'] },
    prompt: [
      'Scan the README and docs for statements that no longer match the current code (paths, commands, flags, APIs).',
      'List each drift: the file/line, what it claims, and what the code actually does now.',
      'Only report — do not edit the docs.',
    ].join('\n'),
  },
]

// Materializa uma recipe (com overrides opcionais) num rascunho pronto pra salvar. Valida pelo schema da rotina.
export function materializeRecipe(recipe: Recipe, overrides: Partial<RoutineConfig> = {}): RoutineDraft {
  const config = parseConfig({ name: recipe.name, description: recipe.description, ...recipe.config, ...overrides })
  return { id: recipe.id, config, prompt: recipe.prompt }
}
