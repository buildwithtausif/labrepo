import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './NotebookPreview.module.css';

interface NotebookPreviewProps {
  content: string;
}

export function NotebookPreview({ content }: NotebookPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && (window as any).hljs) {
      const codeBlocks = containerRef.current.querySelectorAll('pre code');
      codeBlocks.forEach((block) => {
        if (!block.classList.contains('hljs')) {
          (window as any).hljs.highlightElement(block);
        }
      });
    }
  }, [content]);

  let notebook: any;
  try {
    notebook = JSON.parse(content);
  } catch (e) {
    return <div className={styles.notebookContainer}>Invalid Notebook JSON</div>;
  }

  const cells = notebook.cells || [];
  const defaultLang = notebook?.metadata?.language_info?.name || 'python';

  const renderOutput = (output: any, index: number) => {
    if (output.output_type === 'stream') {
      const text = Array.isArray(output.text) ? output.text.join('') : output.text;
      return (
        <div key={index} className={styles.outputRow}>
          <div className={styles.prompt}></div>
          <div className={styles.outputContent}>
            <div className={styles.outputStream}>{text}</div>
          </div>
        </div>
      );
    }
    
    if (output.output_type === 'error') {
      const traceback = output.traceback ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`;
      // Basic ANSI strip for clean tracebacks
      const cleanTraceback = traceback.replace(/\u001b\[[0-9;]*m/g, '');
      return (
        <div key={index} className={styles.outputRow}>
          <div className={styles.prompt}></div>
          <div className={styles.outputContent}>
            <div className={styles.outputError}>{cleanTraceback}</div>
          </div>
        </div>
      );
    }

    if (output.output_type === 'display_data' || output.output_type === 'execute_result') {
      const data = output.data || {};
      const executionCount = output.execution_count;
      const promptText = executionCount !== undefined && executionCount !== null ? `Out[${executionCount}]:` : '';

      if (data['image/png']) {
        return (
          <div key={index} className={styles.outputRow}>
            <div className={`${styles.prompt} ${styles.promptOut}`}>{promptText}</div>
            <div className={styles.outputContent}>
              <img className={styles.outputImage} src={`data:image/png;base64,${data['image/png'].replace(/\n/g, '')}`} alt="output" />
            </div>
          </div>
        );
      }
      
      if (data['text/html']) {
        const html = Array.isArray(data['text/html']) ? data['text/html'].join('') : data['text/html'];
        return (
          <div key={index} className={styles.outputRow}>
            <div className={`${styles.prompt} ${styles.promptOut}`}>{promptText}</div>
            <div className={styles.outputContent}>
              <div className={styles.outputHtml} dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          </div>
        );
      }
      
      if (data['text/plain']) {
        const text = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : data['text/plain'];
        return (
          <div key={index} className={styles.outputRow}>
            <div className={`${styles.prompt} ${styles.promptOut}`}>{promptText}</div>
            <div className={styles.outputContent}>
              <div className={styles.outputStream}>{text}</div>
            </div>
          </div>
        );
      }
    }

    return null;
  };

  return (
    <div className={styles.notebookContainer} ref={containerRef}>
      {cells.map((cell: any, i: number) => {
        if (cell.cell_type === 'markdown') {
          const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
          return (
            <div key={i} className={styles.cell}>
              <div className={styles.prompt}></div>
              <div className={styles.markdownCell}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
              </div>
            </div>
          );
        }

        if (cell.cell_type === 'code') {
          const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
          const executionCount = cell.execution_count;
          const promptText = executionCount !== undefined && executionCount !== null ? `In [${executionCount}]:` : 'In [ ]:';

          return (
            <div key={i} className={styles.cell} style={{ flexDirection: 'column' }}>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-3)' }}>
                <div className={`${styles.prompt} ${styles.promptIn}`}>{promptText}</div>
                <div className={styles.codeCellWrapper}>
                  <div className={styles.codeBlock}>
                    <pre><code className={`language-${defaultLang}`}>{source}</code></pre>
                  </div>
                </div>
              </div>
              
              {cell.outputs && cell.outputs.length > 0 && (
                <div className={styles.outputArea}>
                  {cell.outputs.map((output: any, j: number) => renderOutput(output, j))}
                </div>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
