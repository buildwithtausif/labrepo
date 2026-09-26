export interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  canonicalUrl?: string;
  type?: 'website' | 'article' | 'profile';
  noindex?: boolean;
}

export const defaultSEO = {
  title: 'LabRepo — Student Workspace',
  description: 'Safely organize and retrieve your college lab work. Never lose a file again.',
  image: '/images/3d_folder.png', // Default OG image
  type: 'website',
  twitterHandle: '@labrepo',
  siteName: 'LabRepo',
};

export function buildSEO(props: SEOProps = {}, currentPath: string = '') {
  const title = props.title ? `${props.title} | ${defaultSEO.siteName}` : defaultSEO.title;
  const description = props.description || defaultSEO.description;
  const image = props.image || defaultSEO.image;
  
  // Use a base URL from environment or fallback for canonical/OG links
  const siteUrl = typeof process !== 'undefined' && process.env.PUBLIC_SITE_URL 
    ? process.env.PUBLIC_SITE_URL 
    : 'https://labrepo.app'; // Fallback URL if PUBLIC_SITE_URL is not set
    
  const url = props.canonicalUrl || `${siteUrl}${currentPath}`;

  return {
    title,
    description,
    image: image.startsWith('http') ? image : `${siteUrl}${image}`,
    url,
    type: props.type || defaultSEO.type,
    noindex: props.noindex || false,
    siteName: defaultSEO.siteName,
    twitterHandle: defaultSEO.twitterHandle,
  };
}
