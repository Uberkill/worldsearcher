export interface WorkerMessage<T = any> {
  type: string;
  payload: T;
  id?: number;
}

export interface WorkerResponse<T = any> {
  type: string;
  payload: T;
  id: number;
  error?: string;
}
