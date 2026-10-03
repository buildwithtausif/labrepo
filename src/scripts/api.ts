/**
 * LabRepo — Client-side API helper
 * Handles authenticated requests to the Express backend via Clerk session tokens.
 */

const API_BASE = '/api';

/**
 * Get the current Clerk session token.
 */
async function getToken(): Promise<string | null> {
  try {
    // @ts-ignore — Clerk injects this globally
    const clerk = window.Clerk;
    if (!clerk?.session) return null;
    return await clerk.session.getToken();
  } catch {
    return null;
  }
}

/**
 * Make an authenticated API request.
 */
async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  // Don't set Content-Type for FormData (browser sets boundary automatically)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.error || `Request failed: ${response.status}`);
    (error as any).status = response.status;
    (error as any).data = errorData;
    throw error;
  }

  // Handle blob responses (downloads)
  const contentType = response.headers.get('content-type') || '';
  const contentDisposition = response.headers.get('content-disposition') || '';
  
  if (
    contentType.includes('application/zip') || 
    contentType.includes('application/octet-stream') ||
    contentDisposition.includes('attachment')
  ) {
    return response.blob() as any;
  }

  return response.json();
}

// --- API Functions ---

export const api = {
  // User
  getUserStatus: () => request('/user/status'),
  getStorageStats: () => request('/user/storage-stats'),
  completeOnboarding: () => request('/user/complete-onboarding', { method: 'POST', body: JSON.stringify({}) }),
  getGDriveStatus: () => request('/auth/gdrive/status'),
  connectGDrive: async () => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    window.location.href = `/api/auth/gdrive?token=${encodeURIComponent(token)}`;
    return new Promise(() => {}); // Prevent immediate UI reset while redirecting
  },
  disconnectGDrive: () => request('/auth/gdrive/disconnect', { method: 'POST' }),

  // Sessions
  getSessions: () => request('/sessions'),
  getSession: (id: number) => request(`/sessions/${id}`),
  createSession: (name: string, autoDelete = false, autoDeleteDate?: string) =>
    request('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name, auto_delete: autoDelete, auto_delete_date: autoDeleteDate }),
    }),
  updateSession: (id: number, data: { name?: string; auto_delete?: boolean; auto_delete_date?: string }) =>
    request(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSession: (id: number) => request(`/sessions/${id}`, { method: 'DELETE' }),

  // Subjects
  getSubjects: (sessionId: number) => request(`/sessions/${sessionId}/subjects`),
  getSubject: (id: number) => request(`/subjects/${id}`),
  createSubject: (sessionId: number, name: string) =>
    request(`/sessions/${sessionId}/subjects`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  createSubjectsBatch: (sessionId: number, names: string[]) =>
    request(`/sessions/${sessionId}/subjects/batch`, {
      method: 'POST',
      body: JSON.stringify({ names }),
    }),
  updateSubject: (id: number, name: string) =>
    request(`/subjects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteSubject: (id: number) => request(`/subjects/${id}`, { method: 'DELETE' }),

  // Works
  getWorks: (subjectId: number) => request(`/subjects/${subjectId}/works`),
  getWork: (id: number) => request(`/works/${id}`),
  createWork: (subjectId: number, title?: string) =>
    request(`/subjects/${subjectId}/works`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  updateWork: (id: number, title: string) =>
    request(`/works/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteWork: (id: number) => request(`/works/${id}`, { method: 'DELETE' }),

  // Files
  getFiles: (workId: number) => request(`/works/${workId}/files`),
  uploadFiles: (workId: number, files: FileList | File[], onProgress?: (loaded: number, total: number) => void) => {
    return new Promise<any>(async (resolve, reject) => {
      const token = await getToken();
      if (!token) return reject(new Error('Not authenticated'));

      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/works/${workId}/files`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { resolve({}); }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `Upload failed: ${xhr.status}`));
          } catch { reject(new Error(`Upload failed: ${xhr.status}`)); }
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed: network error'));
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
      xhr.timeout = 300000; // 5 min timeout for uploads
      xhr.send(formData);
    });
  },
  downloadFile: (id: number) => request(`/files/${id}`),
  previewFile: (id: number) => request(`/files/${id}/preview`),
  deleteFile: (id: number) => request(`/files/${id}`, { method: 'DELETE' }),

  // Downloads (bulk) - uses background job with progress
  downloadWork: (id: number, onProgress?: (p: number, total: number) => void) => downloadWithProgress(`/download/prepare/work/${id}`, onProgress),
  downloadSubject: (id: number, onProgress?: (p: number, total: number) => void) => downloadWithProgress(`/download/prepare/subject/${id}`, onProgress),
  downloadSession: (id: number, onProgress?: (p: number, total: number) => void) => downloadWithProgress(`/download/prepare/session/${id}`, onProgress),
  downloadAll: (onProgress?: (p: number, total: number) => void) => downloadWithProgress('/download/prepare/all', onProgress),

  // Recycle Bin
  getRecycleBin: () => request('/recycle-bin'),
  restoreItem: (id: number) => request(`/recycle-bin/${id}/restore`, { method: 'POST' }),
  permanentDelete: (id: number) => request(`/recycle-bin/${id}`, { method: 'DELETE' }),

  // Admin
  getAdminSummary: () => request('/admin/summary'),
  getAdminUsers: () => request('/admin/users'),
  getAuditLogs: () => request('/admin/audit-logs'),
  getAbuseFlags: (page?: number, limit?: number) => request(`/admin/abuse-flags?page=${page || 1}&limit=${limit || 50}`),
  resolveAbuseFlag: (id: string, resolutionNotes: string) => request(`/admin/flags/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolutionNotes }) }),
  suspendUserUploads: (userId: string, notes?: string) => request(`/admin/users/${userId}/suspend-uploads`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  }),
  restoreUserAccount: (userId: string, notes?: string) => request(`/admin/users/${userId}/restore`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  }),
  hardDeleteUser: (userId: string) => request(`/admin/users/${userId}/hard-delete`, {
    method: 'DELETE',
  }),
  getAdminSEO: () => request('/admin/seo'),
  updateAdminSEO: (data: any) => request('/admin/seo', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getAdminConfig: () => request('/admin/config'),
  updateAdminConfig: (data: any) => request('/admin/config', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateUserExtensions: (userId: string, extensions: string) => request(`/admin/users/${userId}/extensions`, {
    method: 'POST',
    body: JSON.stringify({ extensions }),
  }),

  // Announcements API
  getAdminAnnouncements: () => request('/admin/announcements'),
  createAdminAnnouncement: (data: any) => request('/admin/announcements', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminAnnouncement: (id: string, data: any) => request(`/admin/announcements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminAnnouncement: (id: string) => request(`/admin/announcements/${id}`, { method: 'DELETE' }),

  // Search
  search: (params: {
    q?: string;
    sort?: string;
    session_id?: number;
    subject_id?: number;
    extension?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    });
    return request(`/search?${searchParams.toString()}`);
  },
  getSearchFilters: () => request('/search/filters'),
};

// --- Toast notifications ---
export function showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons: Record<string, string> = {
    success: '<i class="bi bi-check-circle"></i>',
    error: '<i class="bi bi-x-circle"></i>',
    warning: '<i class="bi bi-exclamation-triangle"></i>',
    info: '<i class="bi bi-info-circle"></i>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 300ms ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Utility: Download with Progress ---
async function downloadWithProgress(
  preparePath: string,
  onProgress?: (progress: number, total: number) => void
): Promise<Blob> {
  const job = await request<{ jobId: string }>(preparePath, { method: 'POST' });
  const jobId = job.jobId;

  while (true) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const status = await request<{ status: string, progress: number, total: number, error?: string }>(`/download/status/${jobId}`);
    
    if (status.status === 'error') {
      throw new Error(status.error || 'Failed to prepare zip');
    }
    
    if (onProgress) {
      onProgress(status.progress, status.total);
    }

    if (status.status === 'ready') {
      break;
    }
  }

  return request(`/download/file/${jobId}`, {
    // Disable timeout for the actual file transfer since it might take a while
    signal: null as any
  });
}

// --- Utility: Trigger file download from blob ---
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Utility: Format file size ---
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// --- Utility: Format relative time ---
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

// Make api globally available
(window as any).__labrepo_api = api;
(window as any).__labrepo_showToast = showToast;
(window as any).__labrepo_downloadBlob = downloadBlob;
(window as any).__labrepo_formatSize = formatSize;
(window as any).__labrepo_formatRelativeTime = formatRelativeTime;
