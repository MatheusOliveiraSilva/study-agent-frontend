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
  type: 'text' | 'tool' | 'mentor';
  content: string;
  isSearching?: boolean;
}

// Função auxiliar para tentar a requisição várias vezes
const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3) => {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      console.warn(`Tentativa ${i+1} falhou. ${maxRetries - i - 1} tentativas restantes.`);
      lastError = err;
      // Esperar um tempo antes de tentar novamente (backoff exponencial)
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  throw lastError;
};

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
  // Reference para o conteúdo acumulado da pesquisa
  const currentResearchContentRef = useRef<string>('');

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

  // Add a welcome message when streaming starts
  useEffect(() => {
    if (streamingStarted && messages.length === 0) {
      const welcomeId = `mentor-welcome-${Date.now()}`;
      setMessages([{
        id: welcomeId,
        type: 'mentor',
        content: 'Olá! Estou analisando suas informações e gerando um plano de estudos personalizado para você. Vou pesquisar os conteúdos mais relevantes baseados no seu perfil e objetivos.'
      }]);
    }
  }, [streamingStarted, messages.length]);

  // Add a completion message when the plan is finished
  useEffect(() => {
    if (isComplete && messages.length > 0) {
      // Add a small delay to make it feel like the AI is finishing up
      const timer = setTimeout(() => {
        setMessages(prev => [...prev, {
          id: `mentor-completion-${Date.now()}`,
          type: 'mentor',
          content: 'Seu plano de estudos personalizado está pronto! ✅\n\nVocê pode fazer perguntas específicas sobre qualquer tópico do plano, pedir sugestões de recursos adicionais ou solicitar mais detalhes sobre alguma parte específica.\n\nComo posso ajudar você agora?'
        }]);
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [isComplete]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value,
    }));
  };

  // Add a new function to create a fallback plan with improved error handling
  const createFallbackPlan = () => {
    // Se temos conteúdo acumulado, vamos tentar formar um plano mesmo com falhas
    if (textContentRef.current.trim() || currentResearchContentRef.current) {
      const messageId = `mentor-fallback-${Date.now()}`;
      
      // Priorizar o conteúdo mais completo
      const content = currentResearchContentRef.current.length > textContentRef.current.length ? 
        currentResearchContentRef.current : textContentRef.current.trim();
      
      // Se não há conteúdo suficiente, adicionar uma mensagem explicativa
      const finalContent = content.length < 50 ? 
        `Não foi possível gerar um plano completo devido a problemas de conexão. Tente novamente em alguns instantes.` : 
        content;
      
      setMessages(prev => {
        // Verificar se já existe mensagem de mentor
        const mentorMessages = prev.filter(msg => msg.type === 'mentor');
        
        if (mentorMessages.length === 0) {
          // Se não existir mensagem de mentor, criar uma nova
          return [...prev, {
            id: messageId,
            type: 'mentor',
            content: finalContent
          }];
        } else {
          // Atualizar a mensagem mais recente do mentor se tiver pouco conteúdo
          // ou adicionar uma nova mensagem se todas as mensagens existentes já tiverem conteúdo substancial
          const lastMentorMsg = mentorMessages[mentorMessages.length - 1];
          
          // Se a última mensagem é muito curta, atualizar
          if (lastMentorMsg.content.length < 100) {
            return prev.map(msg => 
              msg.id === lastMentorMsg.id
                ? {...msg, content: finalContent}
                : msg
            );
          } else {
            // Adicionar uma nova mensagem
            return [...prev, {
              id: messageId,
              type: 'mentor',
              content: finalContent
            }];
          }
        }
      });
    }
  };

  // Handle form submission and initiate streaming
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    textContentRef.current = ''; // Reset text ref
    currentResearchContentRef.current = ''; // Reset research content ref
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
      
      const response = await fetchWithRetry(STUDY_PLAN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream' // Explicitly accept SSE
        },
        body: JSON.stringify(requestData)
      }, 2); // Tentar no máximo 2 vezes

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
      
      // Add state for tracking current content per node
      const contentByNode: Record<string, string> = {
        'research': '',
        'tools': ''
      };
      let lastMessagesByNode: Record<string, string> = {};
      let mainContentMessage: string | null = null;
      
      // Track the last research node content to accumulate it
      let currentResearchContent = '';
      let currentResearchMessageId: string | null = null;

      while (true) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any remaining content in the text buffer
            if (textContentRef.current.trim()) {
              // Only update the latest research message if we have one
              if (currentResearchMessageId) {
                setMessages(prev => prev.map(msg => 
                  msg.id === currentResearchMessageId 
                    ? {...msg, content: currentResearchContentRef.current}
                    : msg
                ));
              } else if (lastMessagesByNode['research']) {
                const messageToUpdate = messages.find(msg => msg.id === lastMessagesByNode['research']);
                if (messageToUpdate) {
                  setMessages(prev => prev.map(msg => 
                    msg.id === lastMessagesByNode['research'] 
                      ? {...msg, content: contentByNode['research'] + textContentRef.current.trim()}
                      : msg
                  ));
                } else {
                  // If we don't have a research message yet, create one
                  const newId = `mentor-${Date.now()}`;
                  mainContentMessage = newId;
                  setMessages(prev => [...prev, {
                    id: newId,
                    type: 'mentor',
                    content: textContentRef.current.trim()
                  }]);
                }
              } else {
                // If no previous research message exists
                const newMsgId = `mentor-${Date.now()}`;
                lastMessagesByNode['research'] = newMsgId;
                mainContentMessage = newMsgId;
                setMessages(prev => [...prev, {
                  id: newMsgId,
                  type: 'mentor',
                  content: textContentRef.current.trim()
                }]);
              }
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
                  // Parse the JSON response object with content and meta
                  const responseObj = JSON.parse(jsonString);
                  const content = responseObj.content || '';
                  const meta = responseObj.meta || {};
                  
                  // Get the node type from meta
                  const currentGraphNode = meta.langgraph_node || null;
                  
                  if (currentGraphNode) {
                    setCurrentNode(currentGraphNode);
                    
                    // Initialize content for this node if it doesn't exist
                    if (!contentByNode[currentGraphNode]) {
                      contentByNode[currentGraphNode] = '';
                    }

                    // Handle different node types - processar pesquisa e conteúdo separadamente
                    if (currentGraphNode === 'research_node' || currentGraphNode === 'research') {
                      // Para blocos de conteúdo/research, sempre acumular em uma única mensagem
                      contentByNode['research'] += content;
                      textContentRef.current += content;
                      
                      // Se já temos uma mensagem de research, atualizá-la
                      // Se não, verificar se é preciso criar uma
                      if (currentResearchMessageId) {
                        // Atualizar a mensagem existente
                        currentResearchContentRef.current += content;
                        
                        // Atualizar a mensagem apenas periodicamente para evitar re-renderizações desnecessárias
                        // ou quando tiver acumulado uma quantidade significativa de texto
                        if (content.includes('\n\n') || content.includes('.') || content.length > 100) {
                          setMessages(prev => prev.map(msg => 
                            msg.id === currentResearchMessageId 
                              ? {...msg, content: currentResearchContentRef.current}
                              : msg
                          ));
                        }
                      } 
                      // Se ainda não temos mensagem de research mas já temos conteúdo suficiente, criar uma
                      else if (textContentRef.current.length > 20) {
                        // Criar uma nova mensagem
                        const newMsgId = `mentor-${Date.now()}`;
                        currentResearchMessageId = newMsgId;
                        currentResearchContentRef.current = textContentRef.current;
                        lastMessagesByNode['research'] = newMsgId;
                        mainContentMessage = newMsgId;
                        
                        setMessages(prev => [...prev, {
                          id: newMsgId,
                          type: 'mentor',
                          content: currentResearchContentRef.current
                        }]);
                      }
                    } 
                    // Handle tool executions separately (web search results)
                    else if (currentGraphNode === 'tools' && content) {
                      // Check if content is a web search result
                      if (content.includes('Here are the web search results')) {
                        setMessages(prev => [...prev, {
                          id: `tool-${Date.now()}`,
                          type: 'tool',
                          content: content,
                          isSearching: false
                        }]);
                      }
                    }
                  }
                }
              } catch (e) {
                console.error('Error parsing JSON from stream:', e, 'Raw line:', line);
                // Don't set error here, just log it - we want to continue processing if possible
              }
            }
          }
        } catch (streamError) {
          console.error('Stream reading error:', streamError);
          
          // If we have accumulated content, make sure it's displayed
          if (textContentRef.current.trim() && contentByNode['research']) {
            // Try to preserve any content we've received so far
            if (mainContentMessage) {
              // Update existing message with what we have
              setMessages(prev => prev.map(msg => 
                msg.id === mainContentMessage
                  ? {...msg, content: contentByNode['research']}
                  : msg
              ));
            } else {
              // Create a new message with accumulated content
              createFallbackPlan();
            }
          } else {
            createFallbackPlan();
          }
          
          setError('Ocorreu um erro de conexão. O plano pode estar incompleto.');
          setIsComplete(true);
          setIsLoading(false);
          break;
        }
      }

    } catch (err: any) {
      console.error('Error fetching or processing stream:', err);
      
      // Tente criar um plano com qualquer conteúdo que tenha chegado
      createFallbackPlan();
      
      // Show clearer error message
      let errorMessage = 'Falha ao gerar o plano de estudos.';
      if (err.message.includes('network') || err.message.includes('Network') || err.message.includes('Failed to fetch')) {
        errorMessage = 'Erro de conexão. Por favor, verifique sua internet e tente novamente.';
      } else if (err.message.includes('API Error')) {
        errorMessage = `Erro do servidor: ${err.message}`;
      }
      
      setError(errorMessage);
      setIsComplete(true);
      setIsLoading(false);
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
          
          {/* Display error in a more visible way when in content view */}
          {error && (
            <div className="error-container">
              <p className="error-message">{error}</p>
            </div>
          )}
          
          {/* Display messages in sequence */}
          <div className="messages-container">
            {messages.map((message) => (
              message.type === 'tool' ? (
                <ToolExecutionContainer 
                  key={message.id}
                  toolData={message.content}
                  isSearching={message.isSearching}
                />
              ) : message.type === 'mentor' ? (
                <div key={message.id} className="mentor-message">
                  <div className="mentor-avatar">AI</div>
                  <div className="mentor-content">
                    {message.content}
                  </div>
                </div>
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
                <span>Pesquisando mais informações...</span>
              </div>
            )}
          </div>
          
          {isComplete && (
            <div className="user-input-container">
              <input 
                type="text" 
                className="user-chat-input" 
                placeholder="Faça uma pergunta sobre seu plano..." 
                disabled={true} // Disabled for now as backend isn't ready
              />
              <button className="send-button" disabled={true}>Enviar</button>
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