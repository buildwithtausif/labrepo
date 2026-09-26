import React, { useState, useEffect } from 'react';
import { NotebookPreview } from './NotebookPreview';

export function NotebookIsland() {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    const handlePreview = (e: Event) => {
      const customEvent = e as CustomEvent;
      setContent(customEvent.detail.content);
    };
    
    const handleClear = () => {
      setContent(null);
    };

    window.addEventListener('preview-notebook', handlePreview);
    window.addEventListener('clear-notebook', handleClear);

    return () => {
      window.removeEventListener('preview-notebook', handlePreview);
      window.removeEventListener('clear-notebook', handleClear);
    };
  }, []);

  if (!content) return null;
  return <NotebookPreview content={content} />;
}
