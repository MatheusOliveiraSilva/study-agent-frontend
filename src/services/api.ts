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

// Interface for the streamed data structure
export interface StreamChunk {
  content?: string; // Content might be null/empty in some meta-only chunks
  meta?: {
    langgraph_node?: string;
    langgraph_step?: number;
    // other potential meta fields
    [key: string]: any;
  };
}


export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const STUDY_PLAN_ENDPOINT = `${API_BASE_URL}/study_plan/generate_study_plan`; 