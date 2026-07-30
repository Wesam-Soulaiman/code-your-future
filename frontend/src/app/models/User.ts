export interface User {
  id?: string;
  objectId?: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  createdAt?: string;
  updatedAt?: string;
  role?: string[];
  sessionToken?: string;
}
