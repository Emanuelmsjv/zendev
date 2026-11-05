import { describe, expect, it } from 'vitest'
import { assessCommand } from '../src/lib/commands'

describe('assessCommand', () => {
  const destructive = [
    'git push --force origin main',
    'git push -f',
    'git reset --hard HEAD~3',
    'git clean -fdx',
    'rm -rf ./data',
    'rm -fr build',
    'rm -r -f ./cache',
    'DROP TABLE users;',
    'drop database prod',
    'DELETE FROM orders',
    'delete from orders;',
    'TRUNCATE TABLE sessions',
    'terraform destroy -auto-approve',
    'kubectl delete pod api-0',
    'docker system prune -af',
    'dd if=/dev/zero of=/dev/sda',
    'shutdown -h now',
  ]

  for (const command of destructive) {
    it(`flags "${command}" as irreversible`, () => {
      expect(assessCommand(command).level).toBe('destructive')
    })
  }

  const caution = [
    'git push --force-with-lease origin main',
    'npm publish --access public',
    'git commit -am "wip" --no-verify',
    'chmod -R 777 .',
    'git branch -D feature',
    'kill -9 1234',
    'docker rm -f api',
  ]

  for (const command of caution) {
    it(`flags "${command}" as needing care`, () => {
      expect(assessCommand(command).level).toBe('caution')
    })
  }

  const safe = [
    'git push origin main',
    'npm test',
    'git commit -am "checkpoint"',
    'ls -la',
    'DELETE FROM orders WHERE id = 4',
    'rm ./notes.txt',
    'git clean -n',
    'npm install',
  ]

  for (const command of safe) {
    it(`leaves "${command}" alone`, () => {
      expect(assessCommand(command).level).toBe('safe')
    })
  }

  it('treats empty input as safe', () => {
    expect(assessCommand('   ')).toEqual({ level: 'safe', rule: null, detail: null })
  })

  it('normalises whitespace before matching', () => {
    expect(assessCommand('  git    push    --force   origin  main ').level).toBe('destructive')
  })

  it('reports the rule and a human reason', () => {
    const result = assessCommand('git push --force origin main')
    expect(result.rule).toBe('git-force-push')
    expect(result.detail).toContain('Rewrites remote history')
  })
})
