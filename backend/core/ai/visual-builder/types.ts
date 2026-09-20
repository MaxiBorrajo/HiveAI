// ==========================================
// 1. STATE & REDUCERS
// ==========================================
export type ReducerStrategy = 
  | 'overwrite'       // Reemplaza el viejo por el nuevo (Por defecto)
  | 'append'          // Agrega al final de un array
  | 'prepend'         // Agrega al inicio de un array
  | 'unique_append'   // Agrega al array solo si no existe
  | 'merge_dict'      // Object.assign(old, new)
  | 'sum'             // old + new
  | 'subtract'        // old - new
  | 'multiply'        // old * new
  | 'divide';         // old / new

export type DataType = 
  | 'string' | 'number' | 'boolean' 
  | 'object' | 'array' | 'enum' | 'unknown';

export interface StatePropertyDefinition {
  name?: string; // Not strictly required in properties object if used as a record value
  type: DataType;
  required: boolean;
  default?: any;
  
  // Soporte para anidamiento y colecciones
  properties?: Record<string, StatePropertyDefinition>; // Si type === 'object'
  items?: StatePropertyDefinition;                      // Si type === 'array'
  options?: string[];                                   // Si type === 'enum'
  
  // La estrategia del reducer. Si no se envía, se asume 'overwrite'
  reducerStrategy?: ReducerStrategy; 
}

// ==========================================
// 2. NODOS
// ==========================================
export type NodeType = 'start' | 'end' | 'llm' | 'tool' | 'compute';

export interface GraphNode {
  id: string;   // ID interno (ej. "node_123")
  name: string; // Etiqueta visual (ej. "Analista IA")
  type: NodeType;
  
  // Posición para renderizar en React Flow
  uiPosition?: { x: number; y: number };

  config: Record<string, any>; // Configuración dinámica para el plugin/función
}

// ==========================================
// 3. CONEXIONES (EDGES) Y CONDICIONES
// ==========================================
export type ConditionOperator = 
  // Igualdad
  | 'equals' | 'not_equals' 
  // Matemáticos
  | 'greater_than' | 'greater_than_or_equals' | 'less_than' | 'less_than_or_equals'
  // Strings / Colecciones
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  // Existencia
  | 'is_empty' | 'is_not_empty'
  // Listas
  | 'in' | 'not_in'
  // Avanzado
  | 'regex_match';

export interface GraphEdge {
  id: string;      // ID de la conexión (ej. "edge_1")
  source: string;  // ID del nodo de origen
  target: string;  // ID del nodo de destino (o "__end__")
  
  isConditional: boolean;
  
  // La regla se evalúa SOLO si isConditional === true
  condition?: {
    field: string;              // Ruta en el estado (ej. "evaluacion.score" o "messages")
    operator: ConditionOperator;
    value: any;                 // Valor estático contra el que se compara
  };
}

// ==========================================
// 4. EL ROOT DEL JSON
// ==========================================
export interface LangGraphAbstraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

