import React, { useState, useRef } from 'react';
import './StudyPlanForm.css'; // We will create this CSS file next
// Import interfaces and constants from api service
import { StudyPlanRequest, StreamChunk, LLMConfig, STUDY_PLAN_ENDPOINT } from '../../services/api';
import { v4 as uuidv4 } from 'uuid'; // Import uuid to generate thread_id

// Placeholder components for loading states
const StandardLoadingSpinner: React.FC = () => <div className="loading-spinner">🌀 Carregando...</div>;
const ToolsAnimation: React.FC = () => (
  <div className="tools-animation">
    {/* Replace with actual animation if available */}
    <span>🛠️ Pesquisando informações...</span>
  </div>
);

interface FormData {
  techExperience: string;
  techStack: string;
  careerGoals: string;
  personalProjects: string;
}

const StudyPlanForm: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    techExperience: '',
    techStack: '',
    careerGoals: '',
    personalProjects: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  // Rename studyPlan state to result to better match streaming nature
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  // Add state for current processing node
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  // Use ref to accumulate stream content efficiently
  const resultRef = useRef<string>('');
  const [isComplete, setIsComplete] = useState<boolean>(false); // Track if stream is complete

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value,
    }));
  };

  // Handle form submission and initiate streaming
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    resultRef.current = ''; // Reset result ref
    setResult(''); // Reset result state
    setCurrentNode(null); // Reset node state
    setIsComplete(false); // Reset completion state

    // Prepare request data
    const requestData: StudyPlanRequest = {
      thread_id: uuidv4(), // Generate a unique ID for this conversation
      tech_xp: formData.techExperience,
      actual_tech_stack: formData.techStack,
      carrer_goals: formData.careerGoals, // Ensure this matches your backend field name
      side_project_goal: formData.personalProjects,
      llm_config: { // Default LLM config - consider making this configurable
        model: "o4-mini",
        provider: "openai",
        reasoning_effort: "high",
        temperature: 0,
        max_tokens: 10000,
      }
    };

    try {
      const response = await fetch(STUDY_PLAN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream' // Explicitly accept SSE
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        // Handle non-2xx responses before trying to read stream
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText || response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is missing');
      }

      // Process the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          setIsComplete(true); // Mark stream as complete
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process buffer line by line for SSE events
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line (if any) in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonString = line.substring(6).trim();
              if (jsonString) { // Ensure jsonString is not empty
                const jsonData: StreamChunk = JSON.parse(jsonString);
                // Update state based on parsed data
                if (jsonData.content) {
                  resultRef.current += jsonData.content;
                  setResult(resultRef.current);
                }
                if (jsonData.meta && jsonData.meta.langgraph_node) {
                  setCurrentNode(jsonData.meta.langgraph_node);
                }
              }
            } catch (e) {
              console.error('Error parsing JSON from stream:', e, 'Raw line:', line);
              // Decide if we should stop or continue on parsing error
              setError('Erro ao processar parte da resposta do servidor.');
            }
          }
        }
      }

      // Optional: Reset form fields after successful stream completion
      // setFormData({ techExperience: '', techStack: '', careerGoals: '', personalProjects: '' });

    } catch (err: any) {
      console.error('Error fetching or processing stream:', err);
      setError(err.message || 'Falha ao gerar o plano de estudos. Verifique a conexão com a API e tente novamente.');
      setIsComplete(true); // Ensure loading stops even on error
    } finally {
      // Set loading to false only when the stream is marked as complete (success or error)
      // This prevents the form from reappearing prematurely if the stream starts slowly
      // We'll handle final loading state based on isComplete flag below
    }
  };

  // Determine if we are showing the form, loading indicator, or the result
  const showForm = !isLoading && !isComplete;
  const showLoading = isLoading && !isComplete;
  const showResult = isComplete;

  return (
    <div className="study-plan-form-container">
      <h1>Crie seu Plano de Estudos Personalizado</h1>
      <p>Forneça algumas informações para que a IA possa gerar o melhor plano para você.</p>

      {showForm && (
        <form onSubmit={handleSubmit} className="study-plan-form">
          <label htmlFor="techExperience">Experiência Técnica</label>
          <textarea
            id="techExperience"
            name="techExperience"
            value={formData.techExperience}
            onChange={handleChange}
            placeholder="Descreva sua experiência com programação, tecnologias que já usou, nível (iniciante, intermediário, avançado), etc."
            rows={4}
            required
            disabled={isLoading} // Disable form while loading
          />

          <label htmlFor="techStack">Tech Stack Desejada</label>
          <textarea
            id="techStack"
            name="techStack"
            value={formData.techStack}
            onChange={handleChange}
            placeholder="Quais tecnologias ou áreas você quer aprender ou aprofundar? (Ex: React, Node.js, Python para Data Science, Cloud AWS)"
            rows={4}
            required
            disabled={isLoading}
          />

          <label htmlFor="careerGoals">Objetivos de Carreira</label>
          <textarea
            id="careerGoals"
            name="careerGoals"
            value={formData.careerGoals}
            onChange={handleChange}
            placeholder="Quais são seus objetivos de carreira a curto e longo prazo? (Ex: Conseguir primeiro emprego como dev front-end, me tornar Sênior, trabalhar com IA)"
            rows={4}
            required
            disabled={isLoading}
          />

          <label htmlFor="personalProjects">Ideias de Projetos Pessoais</label>
          <textarea
            id="personalProjects"
            name="personalProjects"
            value={formData.personalProjects}
            onChange={handleChange}
            placeholder="Tem alguma ideia de projeto pessoal que gostaria de construir durante seus estudos?"
            rows={4}
            required
            disabled={isLoading}
          />

          <button type="submit" disabled={isLoading}>
            Gerar Plano de Estudos
          </button>

          {/* Error message specifically for form submission stage */}
          {error && !isLoading && <p className="error-message">{error}</p>}
        </form>
      )}

      {/* Loading indicator section */}
      {showLoading && (
        <div className="loading-indicator">
          {currentNode === 'tools' ? (
            <ToolsAnimation />
          ) : (
            <StandardLoadingSpinner />
          )}
          <p className="loading-status">Status: {currentNode || 'Iniciando...'}</p>
          {/* Display partial results during loading */}
          {result && (
            <div className="partial-result">
              <h3>Progresso:</h3>
              <pre>{result}</pre>
            </div>
          )}
        </div>
      )}

      {/* Result section - shown after stream completion */}
      {showResult && (
        <div className="study-plan-result">
          <h2>Seu Plano de Estudos Personalizado:</h2>
          {error && <p className="error-message">{error}</p>} {/* Display error if completion was due to an error */}
          <pre>{result || (error ? 'Nenhum plano gerado devido a erro.' : 'Nenhum conteúdo recebido.')}</pre>
          <button onClick={() => { setIsLoading(false); setIsComplete(false); setResult(''); setError(null); setCurrentNode(null); /* Reset form? */ }}>
            Gerar Novo Plano
          </button>
        </div>
      )}
    </div>
  );
};

export default StudyPlanForm; 