import type { RiskAssessment } from './types'

interface Rule {
  id: string
  level: 'caution' | 'destructive'
  detail: string
  test: (command: string) => boolean
}

const DESTRUCTIVE_RULES: Rule[] = [
  {
    id: 'git-force-push',
    level: 'destructive',
    detail: 'Rewrites remote history that other people may already have pulled.',
    test: (c) =>
      /\bgit\s+push\b/i.test(c) && /(?:^|\s)(?:-f|--force)(?:\s|$)/i.test(c.replace(/--force-with-lease/gi, '')),
  },
  {
    id: 'git-reset-hard',
    level: 'destructive',
    detail: 'Discards every uncommitted change in the working tree.',
    test: (c) => /\bgit\s+reset\s+--hard\b/i.test(c),
  },
  {
    id: 'git-clean-force',
    level: 'destructive',
    detail: 'Deletes untracked files, including anything you forgot to add.',
    test: (c) => /\bgit\s+clean\b/i.test(c) && /(?:^|\s)-[a-z]*f/i.test(c),
  },
  {
    id: 'rm-recursive-force',
    level: 'destructive',
    detail: 'Recursively deletes files without a recoverable step.',
    test: (c) => {
      if (!/\brm\b/i.test(c) || /--dry-run/i.test(c)) return false
      const combined = /(?:^|\s)-[a-z]*(?:r[a-z]*f|f[a-z]*r)/i.test(c)
      const separate =
        /(?:^|\s)-[a-z]*r[a-z]*(?=\s)/i.test(c) && /(?:^|\s)-[a-z]*f/i.test(c)
      return combined || separate
    },
  },
  {
    id: 'sql-drop',
    level: 'destructive',
    detail: 'Drops a database object and the data inside it.',
    test: (c) => /\bdrop\s+(?:table|database|schema)\b/i.test(c),
  },
  {
    id: 'sql-truncate',
    level: 'destructive',
    detail: 'Empties a table in place, usually with no undo.',
    test: (c) => /\btruncate\s+table\b/i.test(c),
  },
  {
    id: 'sql-delete-all',
    level: 'destructive',
    detail: 'Deletes rows with no WHERE clause, which means all of them.',
    test: (c) => {
      const match = c.match(/\bdelete\s+from\s+[^;]+/i)
      if (!match) return false
      return !/\bwhere\b/i.test(match[0])
    },
  },
  {
    id: 'terraform-destroy',
    level: 'destructive',
    detail: 'Tears down infrastructure that may not be reproducible.',
    test: (c) => /\bterraform\s+destroy\b/i.test(c),
  },
  {
    id: 'kubectl-delete',
    level: 'destructive',
    detail: 'Removes live cluster resources.',
    test: (c) => /\bkubectl\s+delete\b/i.test(c),
  },
  {
    id: 'docker-prune',
    level: 'destructive',
    detail: 'Prunes images and volumes, including ones not in a registry.',
    test: (c) => /\bdocker\s+system\s+prune\b/i.test(c) && /(?:^|\s)-[a-z]*a/i.test(c),
  },
  {
    id: 'disk-write',
    level: 'destructive',
    detail: 'Writes raw blocks to a device.',
    test: (c) => /\bdd\s+if=/i.test(c) || /\bmkfs(?:\.\w+)?\b/i.test(c),
  },
  {
    id: 'power-state',
    level: 'destructive',
    detail: 'Interrupts the machine and every unsaved buffer on it.',
    test: (c) => /^\s*(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff)\b/i.test(c),
  },
]

const CAUTION_RULES: Rule[] = [
  {
    id: 'force-with-lease',
    level: 'caution',
    detail: 'Force-pushes, but only if nobody else has pushed since your last fetch.',
    test: (c) => /\bgit\s+push\b/i.test(c) && /--force-with-lease\b/i.test(c),
  },
  {
    id: 'publish',
    level: 'caution',
    detail: 'Publishes a version that cannot be unpublished from every registry.',
    test: (c) => /\bnpm\s+publish\b/i.test(c),
  },
  {
    id: 'skip-hooks',
    level: 'caution',
    detail: 'Bypasses the checks that would normally catch this.',
    test: (c) => /--no-verify\b/i.test(c),
  },
  {
    id: 'chmod-wide',
    level: 'caution',
    detail: 'Grants world write access recursively.',
    test: (c) => /\bchmod\s+-R\s+777\b/i.test(c),
  },
  {
    id: 'branch-delete',
    level: 'caution',
    detail: 'Deletes a branch even if it is not merged.',
    test: (c) => /\bgit\s+branch\s+-D\b/i.test(c),
  },
  {
    id: 'kill-hard',
    level: 'caution',
    detail: 'Sends SIGKILL, so the process cannot clean up.',
    test: (c) => /\bkill\s+-9\b/i.test(c),
  },
  {
    id: 'docker-rm-force',
    level: 'caution',
    detail: 'Force-removes a running container.',
    test: (c) => /\bdocker\s+rm\s+-f\b/i.test(c),
  },
]

export function assessCommand(input: string): RiskAssessment {
  const command = input.trim().replace(/\s+/g, ' ')
  if (command.length === 0) {
    return { level: 'safe', rule: null, detail: null }
  }

  for (const rule of DESTRUCTIVE_RULES) {
    if (rule.test(command)) {
      return { level: rule.level, rule: rule.id, detail: rule.detail }
    }
  }

  for (const rule of CAUTION_RULES) {
    if (rule.test(command)) {
      return { level: rule.level, rule: rule.id, detail: rule.detail }
    }
  }

  return { level: 'safe', rule: null, detail: null }
}

export const DESTRUCTIVE_EXAMPLES = [
  'git push --force origin main',
  'git reset --hard HEAD~3',
  'rm -rf ./data',
  'DROP TABLE users;',
  'delete from orders',
]
