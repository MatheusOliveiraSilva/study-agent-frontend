import React from 'react';
import './ToolExecution.css';

interface ToolExecutionProps {
  type: 'search' | 'result';
  content: string;
  title?: string;
  url?: string;
  fullContent?: string;
}

const ToolExecution: React.FC<ToolExecutionProps> = ({ 
  type, 
  content, 
  title, 
  url, 
  fullContent 
}) => {
  // For search queries - remove "Here are the web search results for the query:" prefix
  if (type === 'search') {
    let searchText = content;
    if (searchText.includes('Here are the web search results for the query:')) {
      searchText = searchText.replace('Here are the web search results for the query:', '').trim();
    }
    
    // Remover possíveis tags HTML ou formatação estranha
    searchText = searchText.replace(/<[^>]*>?/gm, '');
    
    // Limitar o tamanho da query caso seja muito grande
    if (searchText.length > 70) {
      searchText = searchText.substring(0, 67) + '...';
    }
    
    // Create a Google search URL
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchText)}`;
    
    return (
      <div 
        className="tool-search-query"
        onClick={() => window.open(googleSearchUrl, '_blank')}
      >
        <span className="search-icon">🔍</span>
        <span className="query-text">{searchText}</span>
        <span className="search-link-indicator">↗</span>
      </div>
    );
  }
  
  // For result pills - ensure we have a display text that's not "Untitled" if possible
  let displayText = content || title || '';
  
  // If content is very long, truncate for display
  if (displayText && displayText.length > 30) {
    displayText = displayText.substring(0, 30) + '...';
  }
  
  // Last resort fallback
  if (!displayText) {
    displayText = 'Untitled';
  }
  
  return (
    <div 
      className="tool-result" 
      title={fullContent || content || title || ''} // Show full content as tooltip
      onClick={() => url && window.open(url, '_blank')}
      style={{ cursor: url ? 'pointer' : 'default' }}
    >
      {displayText}
    </div>
  );
};

// Helper function to get a readable display name for links
function getDisplayNameForLink(url: string): string {
  try {
    // Remove protocol and www
    const cleaned = url.replace(/^(https?:\/\/)?(www\.)?/, '');
    // Get domain or first part of the path
    const parts = cleaned.split('/');
    return parts[0] || url;
  } catch (e) {
    return url;
  }
}

export default ToolExecution; 