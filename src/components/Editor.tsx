import { useMemo, useRef, useState } from 'react'
import { tokenizeLines } from '../lib/highlight'

interface EditorProps {
  path: string
  value: string
  onChange: (next: string) => void
  modified: boolean
}

const AMBIENT = [
  'at async Generator.next (<anonymous>)',
  '    at SessionStore.touch (src/store/session.ts:88:17)',
  'Error: ECONNRESET: socket hang up',
  '    at TCPConnectWrap.afterConnect [as oncomplete]',
  'warning: LF will be replaced by CRLF',
  '    at processTicksAndRejections (node:internal/process/task_queues)',
  'Retrying in 2000ms (attempt 3/5)',
  '    at Pool.<anonymous> (node_modules/pg-pool/index.js:45:11)',
  'UnhandledPromiseRejectionWarning: TimeoutError',
  '    at Timeout._onTimeout (src/jobs/worker.ts:212:9)',
]

export function Editor({ path, value, onChange, modified }: EditorProps) {
  const lines = useMemo(() => tokenizeLines(value), [value])
  const [cursorLine, setCursorLine] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  const syncScroll = () => {
    if (!textareaRef.current || !preRef.current) return
    preRef.current.scrollTop = textareaRef.current.scrollTop
    preRef.current.scrollLeft = textareaRef.current.scrollLeft
  }

  const updateCursor = () => {
    const el = textareaRef.current
    if (!el) return
    setCursorLine(el.value.slice(0, el.selectionStart).split('\n').length - 1)
  }

  return (
    <section className="editor" aria-label="Code editor">
      <div className="tabbar">
        <span className="tab active">
          {path}
          {modified ? <span className="dirty" aria-label="unsaved" /> : null}
        </span>
        <span className="tab">session.test.ts</span>
        <div className="tabbar-right">
          <span className="pill quiet">TypeScript</span>
        </div>
      </div>

      <div className="editor-body">
        <div className="gutter" aria-hidden="true">
          {lines.map((_, index) => (
            <span key={index} className={index === cursorLine ? 'line-number active' : 'line-number'}>
              {index + 1}
            </span>
          ))}
        </div>

        <div className="code-area">
          <pre ref={preRef} className="code-mirror" aria-hidden="true">
            {lines.map((tokens, index) => (
              <div key={index} className={index === cursorLine ? 'code-line active' : 'code-line'}>
                {tokens.length === 0 ? (
                  <span className="tok-plain"> </span>
                ) : (
                  tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} className={`tok-${token.kind}`}>
                      {token.text}
                    </span>
                  ))
                )}
              </div>
            ))}
          </pre>

          <textarea
            ref={textareaRef}
            className="code-input"
            value={value}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Source code"
            onChange={(event) => onChange(event.target.value)}
            onScroll={syncScroll}
            onKeyUp={updateCursor}
            onClick={updateCursor}
          />
        </div>

        <div className="ambient" aria-hidden="true">
          {AMBIENT.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </div>
    </section>
  )
}
