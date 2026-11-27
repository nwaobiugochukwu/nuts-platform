export type ApiResponseDto<T> = {
  success: boolean;
  message: string;
  data: T | null;
  meta?: Meta;
};

export interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
