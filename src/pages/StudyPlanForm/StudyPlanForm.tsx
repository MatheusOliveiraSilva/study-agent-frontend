import React, { useState, useRef, useEffect } from 'react';
import './StudyPlanForm.css'; // We will create this CSS file next
// Import interfaces, constants and helper functions from api service
import { 
  StudyPlanRequest, 
  StreamChunk, 
  LLMConfig, 
  STUDY_PLAN_ENDPOINT,
  isToolExecutionChunk,
  isSetupChunk,
  isContentChunk,
  extractSearchQuery,
  extractSearchResults
} from '../../services/api';
import { v4 as uuidv4 } from 'uuid'; // Import uuid to generate thread_id
import ToolExecutionContainer from '../../components/ToolExecutionContainer';

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

interface MessageData {
  id: string;
  type: 'text' | 'tool';
  content: string;
  isSearching?: boolean;
}

const StudyPlanForm: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    techExperience: '',
    techStack: '',
    careerGoals: '',
    personalProjects: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  // Change to store messages instead of a single result string
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Add state for current processing node
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  // Add state to track if streaming has started
  const [streamingStarted, setStreamingStarted] = useState(false);
  // Use ref to accumulate stream content efficiently
  const textContentRef = useRef<string>('');
  const [isComplete, setIsComplete] = useState<boolean>(false); // Track if stream is complete

  // Add class to body when streaming is active
  useEffect(() => {
    if (streamingStarted) {
      document.body.classList.add('streaming-active');
    } else {
      document.body.classList.remove('streaming-active');
    }
    
    return () => {
      document.body.classList.remove('streaming-active');
    };
  }, [streamingStarted]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      const messagesContainer = document.querySelector('.messages-container');
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }, [messages]);

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
    textContentRef.current = ''; // Reset text ref
    setMessages([]); // Reset messages
    setCurrentNode(null); // Reset node state
    setStreamingStarted(false); // Reset streaming state
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
      // Immediately show the title with loading spinner
      setStreamingStarted(true);
      
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
          // Flush any remaining content in the text buffer
          if (textContentRef.current.trim()) {
            setMessages(prev => [...prev, {
              id: `text-${Date.now()}`,
              type: 'text',
              content: textContentRef.current.trim()
            }]);
            textContentRef.current = '';
          }
          setIsComplete(true); // Mark stream as complete
          setIsLoading(false); // Stop loading spinner
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
                
                // Update current node
                if (jsonData.meta && jsonData.meta.langgraph_node) {
                  const prevNode = currentNode;
                  setCurrentNode(jsonData.meta.langgraph_node);
                  
                  // If we're switching from content to tools, flush text content
                  if (
                    prevNode && 
                    prevNode !== 'tools' && 
                    jsonData.meta.langgraph_node === 'tools' && 
                    textContentRef.current.trim()
                  ) {
                    setMessages(prev => [...prev, {
                      id: `text-${Date.now()}`,
                      type: 'text',
                      content: textContentRef.current.trim()
                    }]);
                    textContentRef.current = '';
                  }
                }
                
                // Skip setup chunks
                if (isSetupChunk(jsonData)) {
                  continue;
                }
                
                // Handle tool execution chunks
                if (isToolExecutionChunk(jsonData) && jsonData.content) {
                  setMessages(prev => [...prev, {
                    id: `tool-${Date.now()}`,
                    type: 'tool',
                    content: jsonData.content || '',
                    isSearching: false // Already completed
                  }]);
                }
                // Handle content chunks (non-tool, non-setup)
                else if (isContentChunk(jsonData)) {
                  // Accumulate content
                  textContentRef.current += jsonData.content;
                  
                  // Only add as a message if it contains a sentence end or paragraph break
                  // This prevents too many tiny messages
                  if (
                    textContentRef.current.includes('.\n') || 
                    textContentRef.current.includes('.\n\n') ||
                    textContentRef.current.endsWith('.') ||
                    textContentRef.current.length > 150
                  ) {
                    setMessages(prev => [...prev, {
                      id: `text-${Date.now()}`,
                      type: 'text',
                      content: textContentRef.current.trim()
                    }]);
                    textContentRef.current = '';
                  }
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

    } catch (err: any) {
      console.error('Error fetching or processing stream:', err);
      setError(err.message || 'Falha ao gerar o plano de estudos. Verifique a conexão com a API e tente novamente.');
      setIsComplete(true); // Ensure loading stops even on error
      setIsLoading(false); // Stop loading spinner
    }
  };

  // Determine if we are showing the form or the content
  const showForm = !streamingStarted;
  const showContent = streamingStarted;

  return (
    <div className={`study-plan-form-container ${streamingStarted ? 'streaming-active' : ''}`}>
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

      {/* Content Container - Shows both during streaming and after completion */}
      {showContent && (
        <div className="study-plan-content">
          <div className="study-plan-header">
            <h2>Seu Plano de Estudos Personalizado:</h2>
          </div>
          
          {error && <p className="error-message">{error}</p>}
          
          {/* Display messages in sequence */}
          <div className="messages-container">
            {messages.map((message) => (
              message.type === 'tool' ? (
                <ToolExecutionContainer 
                  key={message.id}
                  toolData={message.content}
                  isSearching={message.isSearching}
                />
              ) : (
                <div key={message.id} className="text-message">
                  <pre>{message.content}</pre>
                </div>
              )
            ))}
            
            {/* Add "Searching more info" indicator at the bottom when loading */}
            {isLoading && messages.length > 0 && (
              <div className="searching-indicator">
                <div className="searching-spinner"></div>
                <span>Searching more info...</span>
              </div>
            )}
          </div>
          
          {/* Final plan chat container placeholder */}
          {isComplete && messages.length > 0 && (
            <div className="final-plan-container">
              <div className="final-plan-header">
                <h3>Plano de Estudos Completo</h3>
              </div>
              <div className="chat-container">
                <div className="ai-message">
                  <div className="ai-avatar">AI</div>
                  <div className="ai-content">
                    <p>Aqui está seu plano de estudos completo. Você pode fazer perguntas sobre ele.</p>
                    <div className="plan-sections">
                      {messages.filter(msg => msg.type === 'text').map((msg, index) => (
                        <div key={`section-${index}`} className="plan-section">
                          <pre>{msg.content}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="user-input-container">
                  <input 
                    type="text" 
                    className="user-chat-input" 
                    placeholder="Faça uma pergunta sobre seu plano..." 
                    disabled={true} // Disabled for now as backend isn't ready
                  />
                  <button className="send-button" disabled={true}>Enviar</button>
                </div>
              </div>
            </div>
          )}
          
          {isComplete && (
            <button 
              onClick={() => { 
                setIsLoading(false); 
                setIsComplete(false); 
                setMessages([]); 
                setError(null); 
                setCurrentNode(null);
                setStreamingStarted(false);
              }}
              className="new-plan-button"
            >
              Gerar Novo Plano
            </button>
          )}
        </div>
      )}
      
      {/* Initial loading indicator - only shown before streaming starts but form is hidden */}
      {!showForm && !messages.length && !error && (
        <div className="loading-indicator-container">
          <div className="loading-spinner"></div>
          <span className="loading-text">Gerando o plano de estudos perfeito...</span>
        </div>
      )}
    </div>
  );
};

export default StudyPlanForm; 