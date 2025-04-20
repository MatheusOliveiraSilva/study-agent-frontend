import React, { useState, useEffect } from 'react';
import ToolExecution from './ToolExecution';
import './ToolExecutionContainer.css';

// Lista de domínios/serviços comuns que podem aparecer nos resultados
const KNOWN_SERVICES = [
  'VesselFinder', 'MarineTraffic', 'GitHub', 'Stack Overflow', 'Datacamp',
  'BOPC', 'Northwest Seaport Alliance', 'Cruising Earth', 'RemoteOK', 'Indeed',
  'LinkedIn', 'Glassdoor', 'Medium', 'freeCodeCamp', 'Coursera', 'Udemy',
  'edX', 'Pluralsight', 'Educative', 'LeetCode', 'HackerRank'
];

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

interface ToolExecutionContainerProps {
  toolData: string;
  isSearching?: boolean;
}

const ToolExecutionContainer: React.FC<ToolExecutionContainerProps> = ({ 
  toolData,
  isSearching = false
}) => {
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [moreCount, setMoreCount] = useState<number | null>(null);

  // Maximum results to show before "more" indicator
  const MAX_VISIBLE_RESULTS = 4;
  
  useEffect(() => {
    if (!toolData) return;
    
    // Split by lines and filter out empty ones
    const lines = toolData.split('\n')
      .map(line => line.trim())
      .filter(line => line && line !== '---');
    
    if (lines.length === 0) return;
    
    // Extract the search query (first line)
    const queryLine = lines[0];
    setSearchQuery(queryLine);
    
    // Check if the last line contains "X more" pattern
    const lastLine = lines[lines.length - 1];
    const moreMatch = lastLine.match(/(\d+)\s+more/i);
    if (moreMatch) {
      setMoreCount(parseInt(moreMatch[1]));
      // Remove the "X more" line from processing
      lines.pop();
    } else {
      setMoreCount(null);
    }
    
    try {
      // First approach: try to process structured data with Source, Title, Content format
      processStructuredData(lines.slice(1));
    } catch (e) {
      console.log('Error processing structured data, falling back to simple format', e);
      // Second approach: treat each line as a simple result
      processSimpleData(lines.slice(1));
    }
    
  }, [toolData]);
  
  // Process data in "Title/Source/Content" format
  const processStructuredData = (lines: string[]) => {
    const results: SearchResult[] = [];
    let currentResult: Partial<SearchResult> = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line === '---') continue;
      
      if (line.startsWith('Source:')) {
        currentResult.url = line.replace('Source:', '').trim();
        continue;
      }
      
      if (line.startsWith('Title:')) {
        if (currentResult.title) {
          // Save previous result if we have a title
          results.push({
            title: currentResult.title,
            url: currentResult.url || '#',
            content: currentResult.content || currentResult.title
          });
          currentResult = {};
        }
        
        currentResult.title = line.replace('Title:', '').trim();
        continue;
      }
      
      if (line.startsWith('Content:')) {
        currentResult.content = line.replace('Content:', '').trim();
        
        if (currentResult.title) {
          results.push({
            title: currentResult.title,
            url: currentResult.url || '#',
            content: currentResult.content || currentResult.title
          });
          currentResult = {};
        }
        continue;
      }
      
      // Handle lines without prefixes
      if (!line.includes(':') && currentResult.title && !currentResult.content) {
        currentResult.content = line;
      } else if (!line.includes(':') && currentResult.content) {
        currentResult.content += ' ' + line;
      }
    }
    
    // Add final result if any
    if (currentResult.title) {
      results.push({
        title: currentResult.title,
        url: currentResult.url || '#',
        content: currentResult.content || currentResult.title
      });
    }
    
    if (results.length === 0) {
      throw new Error('No structured data found');
    }
    
    setSearchResults(results);
  };
  
  // Process simple data where each line is a result 
  const processSimpleData = (lines: string[]) => {
    // Filter out lines that look like they're not results
    const resultLines = lines.filter(line => 
      !line.startsWith('I ') && 
      !line.startsWith('Let me') && 
      !line.startsWith('According') &&
      !line.startsWith('Now I')
    );
    
    // Extract URLs from text
    const extractUrl = (text: string): string => {
      // Check if there's a URL in the text
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) return urlMatch[0];
      
      // Check for domain-like patterns without http://
      const domainMatch = text.match(/\b(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/[^\s]*)?/i);
      if (domainMatch) return domainMatch[0].startsWith('www.') ? `https://${domainMatch[0]}` : `https://www.${domainMatch[0]}`;
      
      return '#'; // Default fallback
    };
    
    const results = resultLines.map((line, index) => {
      // Check if the line contains a known service
      const foundService = KNOWN_SERVICES.find(service => line.includes(service));
      if (foundService) {
        return {
          title: foundService,
          url: extractUrl(line),
          content: line
        };
      }
      
      return {
        title: line,
        url: extractUrl(line),
        content: line
      };
    });
    
    setSearchResults(results);
  };

  if (!searchQuery) {
    return null;
  }

  // Determine how many results to show and if we need a "more" indicator
  const visibleResults = searchResults.slice(0, MAX_VISIBLE_RESULTS);
  const hasMoreResults = moreCount !== null || searchResults.length > MAX_VISIBLE_RESULTS;
  const hiddenResultsCount = moreCount !== null ? moreCount : searchResults.length - MAX_VISIBLE_RESULTS;

  return (
    <div className="tool-execution-container">
      {/* Web search indicator */}
      <div className="web-search-indicator">
        {isSearching ? 'Searching the web' : 'Searched the web'}
      </div>
      
      {/* Search query */}
      <ToolExecution type="search" content={searchQuery} />
      
      {/* Results container */}
      {visibleResults.length > 0 && (
        <div className="tool-results-container">
          {visibleResults.map((result, index) => (
            <ToolExecution 
              key={`result-${index}`} 
              type="result" 
              content={result.title}
              title={result.title}
              url={result.url !== '#' ? result.url : undefined}
              fullContent={result.content} 
            />
          ))}
          {hasMoreResults && (
            <div className="more-results-indicator">
              {hiddenResultsCount} more
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolExecutionContainer; 