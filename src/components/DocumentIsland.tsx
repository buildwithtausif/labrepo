import React, { useState, useEffect } from 'react';
import styles from './DocumentIsland.module.css';

export function DocumentIsland() {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [extension, setExtension] = useState<string | null>(null);
  
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handlePreview = (e: Event) => {
      const customEvent = e as CustomEvent;
      setObjectUrl(customEvent.detail.objectUrl);
      setExtension(customEvent.detail.extension);
    };
    
    const handleClear = () => {
      setObjectUrl(null);
      setExtension(null);
      setHtml(null);
      setError(null);
    };

    window.addEventListener('preview-document', handlePreview);
    window.addEventListener('clear-document', handleClear);

    return () => {
      window.removeEventListener('preview-document', handlePreview);
      window.removeEventListener('clear-document', handleClear);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    async function loadContent() {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(objectUrl!);
        const arrayBuffer = await response.arrayBuffer();

        if (extension === 'docx') {
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (isMounted) {
            setHtml(result.value);
            setLoading(false);
          }
        } else if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
          const xlsx = await import('xlsx');
          const workbook = xlsx.read(arrayBuffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const htmlString = xlsx.utils.sheet_to_html(worksheet);
          
          if (isMounted) {
            // Basic cleanup of SheetJS generated HTML
            const cleanedHtml = htmlString.replace(/<table/g, '<table class="xlsx-table"');
            setHtml(cleanedHtml);
            setLoading(false);
          }
        } else {
          throw new Error('Unsupported document format');
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to render document');
          setLoading(false);
        }
      }
    }

    if (objectUrl && (extension === 'docx' || extension === 'xlsx' || extension === 'xls' || extension === 'csv')) {
      loadContent();
    }
    
    return () => {
      isMounted = false;
    };
  }, [objectUrl, extension]);

  if (!objectUrl) return null;

  if (loading) {
    return (
      <div className="empty-state" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#ff3b30' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.documentContainer}>
      <div className={styles.documentPaper} dangerouslySetInnerHTML={{ __html: html || '' }} />
    </div>
  );
}
