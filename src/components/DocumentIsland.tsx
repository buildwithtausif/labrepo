import React, { useState, useEffect } from 'react';
import styles from './DocumentIsland.module.css';

export function DocumentIsland() {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [extension, setExtension] = useState<string | null>(null);
  
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

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

  const resetZoom = () => {
    setZoom(1);
  };

  return (
    <div 
      className={styles.documentContainer}
    >
      <div className={styles.zoomControls}>
        <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="btn btn--secondary-pill btn--icon btn--sm" aria-label="Zoom Out" title="Zoom Out">
          <i className="bi bi-dash"></i>
        </button>
        <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="btn btn--secondary-pill btn--icon btn--sm" aria-label="Zoom In" title="Zoom In">
          <i className="bi bi-plus"></i>
        </button>
        <button onClick={resetZoom} className="btn btn--ghost btn--icon btn--sm" aria-label="Reset Zoom" title="Reset Zoom">
          <i className="bi bi-arrow-counterclockwise"></i>
        </button>
      </div>
      <div className={styles.paperWrapper}>
        <div 
          className={extension === 'docx' ? styles.documentPaper : styles.spreadsheetPaper} 
          style={{ 
            zoom: zoom,
            transition: 'zoom 0.2s ease'
          }}
          dangerouslySetInnerHTML={{ __html: html || '' }} 
        />
      </div>
    </div>
  );
}
