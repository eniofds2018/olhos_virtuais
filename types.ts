
export enum AppState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR'
}

export interface RecognitionAlert {
  id: string;
  text: string;
  type: 'obstacle' | 'text' | 'info';
  timestamp: number;
}
