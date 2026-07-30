export const sharedGetFields = {
  skip: {required: false, default: 0},
  limit: {required: false, default: 50},
  id: {required: false},
  withCount: {required: false},
};

export interface SharedGetParams {
  id?: string;
  skip?: number | string;
  limit?: number | string;
  withCount?: boolean | string;
}
export type WithSharedGetParams<T = {}> = SharedGetParams & T;
