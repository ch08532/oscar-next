export interface KnowledgeResult { id: string; title: string; source: string; excerpt: string; }
export interface KnowledgeSearchOptions { limit?: number; }
export interface ExpertKnowledgeProvider { search(query: string, options?: KnowledgeSearchOptions): Promise<KnowledgeResult[]>; }
export class NoKnowledgeProvider implements ExpertKnowledgeProvider { async search(): Promise<KnowledgeResult[]> { return []; } }
