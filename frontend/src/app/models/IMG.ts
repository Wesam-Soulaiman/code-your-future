export interface IMGFile {
  __type?: string;
  name?: string;
  url?: string;
  base64?: string;
}

export interface IMG {
  id?: string;
  objectId?: string;
  image?: IMGFile;
  imageThumbNail?: IMGFile;
  blurHash?: string;
  createdAt?: string;
  updatedAt?: string;
}
