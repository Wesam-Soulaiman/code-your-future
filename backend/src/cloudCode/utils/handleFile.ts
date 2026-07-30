import File from '../models/File';

async function createFileFromBase64(
  base64: string,
  name: string
): Promise<Parse.File> {
  const safeName = encodeURIComponent(name);
  const file = new Parse.File(safeName, {base64});

  return await file.save({useMasterKey: true});
}

export async function handleFileLogic<T extends Parse.Object>(
  object: T,
  file: any,
  id: string | undefined,
  attributeName: string
): Promise<void> {
  // no file uploaded
  if (!file) return;

  const className = object.className;

  if (!file?.id && !file?.url && id) {
    const query = new Parse.Query(className);
    query.equalTo('objectId', id);
    query.include([attributeName]);

    const classObject = await query.first({useMasterKey: true});
    const oldFile = classObject?.get(attributeName);
    if (oldFile) {
      await oldFile.destroy({useMasterKey: true});
      object.unset(attributeName);
    }
  }

  let fileObj = new File();

  if (file?.id) {
    fileObj.id = file.id;
  }

  if (file?.base64) {
    const fileUpload = await createFileFromBase64(file.base64, file.name);
    //  console.log('fileUpload', fileUpload);
    fileObj.file = fileUpload;
  }

  object.set(attributeName, fileObj);
}

export async function handleFileArrayLogic<T extends Parse.Object>(
  object: T,
  files: any[] = [],
  id: string | undefined,
  attributeName: string
): Promise<void> {
  const className = object.className;
  const incomingIds = new Set(files.map(f => f.id).filter(Boolean));
  const newFiles: File[] = [];

  if (id) {
    const query = new Parse.Query(className);
    query.equalTo('objectId', id);
    query.include([attributeName]);

    const existingObj = await query.first({useMasterKey: true});
    const currentFiles: File[] = existingObj?.get(attributeName) || [];

    for (const file of currentFiles) {
      if (!incomingIds.has(file.id)) {
        await file.destroy({useMasterKey: true});
      }
    }
  }

  for (const file of files) {
    const fileObj = new File();

    if (file?.id) fileObj.id = file.id;

    if (file?.base64) {
      const mimeType = file.contentType;
      const parseFile = await createFileFromBase64(file.base64, file.name);
      fileObj.file = parseFile;
    }

    newFiles.push(fileObj);
  }

  // ✅ Always overwrite with new list
  object.set(attributeName, newFiles);
}
