// src/services/api.ts

export interface LLMConfig {
  model: string;
  provider: string;
  reasoning_effort: string;
  temperature: number;
  max_tokens?: number; // Optional based on example
}

export interface StudyPlanRequest {
  thread_id: string;
  tech_xp: string;
  actual_tech_stack: string;
  carrer_goals: string; // Corrigido para 'carrer_goals' como no exemplo
  side_project_goal: string;
  llm_config: LLMConfig;
}

// Extended interface for the streamed data structure
export interface StreamChunk {
  content?: string; // Content might be null/empty in some meta-only chunks
  meta?: {
    langgraph_node?: string;
    langgraph_step?: number;
    // Tool-specific metadata
    tool_name?: string; // Name of the tool being executed
    tool_input?: string; // Input provided to the tool
    tool_output?: string; // Output from the tool execution
    // other potential meta fields
    [key: string]: any;
  };
  // New fields for tool data 
  tool_data?: {
    type: string; // Type of tool (e.g., 'web_search', 'code_execution', etc.)
    query?: string; // Query used for search tools
    results?: any[]; // Results from the tool
  };
}


export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const STUDY_PLAN_ENDPOINT = `${API_BASE_URL}/study_plan/generate_study_plan`;

// Helper function to determine if a chunk should be ignored (research_setup)
export function isSetupChunk(chunk: StreamChunk): boolean {
  return chunk.meta?.langgraph_node === 'research_setup';
}

// Helper function to determine if a chunk contains tool execution data
export function isToolExecutionChunk(chunk: StreamChunk): boolean {
  return chunk.meta?.langgraph_node === 'tools';
}

// Helper function to determine if a chunk is regular content
export function isContentChunk(chunk: StreamChunk): boolean {
  return (
    !isSetupChunk(chunk) && 
    !isToolExecutionChunk(chunk) && 
    !!chunk.content && 
    chunk.content.trim() !== ''
  );
}

// Helper function to extract search query from tool content
export function extractSearchQuery(chunk: StreamChunk): string | null {
  if (!isToolExecutionChunk(chunk) || !chunk.content) return null;
  
  const content = chunk.content.trim();
  
  // Try to extract the search query using some patterns
  if (content.includes('search results for') || content.includes('searching for')) {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    return lines[0] || content;
  }
  
  // If it's a single line, it's likely a query
  if (!content.includes('\n')) {
    return content;
  }
  
  // Default to the first line
  return content.split('\n')[0] || content;
}

// Helper function to extract search results
export function extractSearchResults(chunk: StreamChunk): string[] {
  if (!isToolExecutionChunk(chunk) || !chunk.content) return [];
  
  const content = chunk.content.trim();
  const lines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.includes('search results for') && !line.includes('searching for'));
  
  // Extract potential website/service names
  const results: string[] = [];
  for (const line of lines) {
    // Common website patterns
    if (line.includes('://') || /\b\w+\.\w{2,}\b/.test(line)) {
      results.push(line);
      continue;
    }
    
    // Known service names patterns
    const serviceMatches = line.match(/\b(VesselFinder|MarineTraffic|BOPC|Seaport|Alliance|Earth|GitHub|StackOverflow)\b/g);
    if (serviceMatches) {
      results.push(line);
      continue;
    }
    
    // If line is short, it might be a result name
    if (line.length < 50 && !line.includes('searching') && !line.includes('results')) {
      results.push(line);
    }
  }
  
  return results;
}

// Helper function to extract tool data from a chunk
export function extractToolData(chunk: StreamChunk): string | null {
  if (!isToolExecutionChunk(chunk)) return null;
  
  // If there's explicit tool_data, use that
  if (chunk.tool_data) {
    return JSON.stringify(chunk.tool_data);
  }
  
  // If there's tool_output in meta, use that
  if (chunk.meta?.tool_output) {
    return chunk.meta.tool_output;
  }
  
  // If there's content in a tools node, use that
  if (chunk.meta?.langgraph_node === 'tools' && chunk.content) {
    return chunk.content;
  }
  
  return null;
} 