import 'reflect-metadata';
import IMG from '../models/IMG';
import {catchError} from '@90soft/parse-server-kit';
import type {ClassAclTemplate} from '@90soft/parse-server-kit';

function buildACLFromTemplate(template: ClassAclTemplate): Parse.ACL {
  const acl = new Parse.ACL();
  for (const [key, perms] of Object.entries(template)) {
    if (key === '*') {
      if (perms.read) acl.setPublicReadAccess(true);
      if (perms.write) acl.setPublicWriteAccess(true);
    } else if (key.startsWith('role:')) {
      const roleName = key.substring(5);
      if (perms.read) acl.setRoleReadAccess(roleName, true);
      if (perms.write) acl.setRoleWriteAccess(roleName, true);
    }
  }
  return acl;
}

async function createImageFromBase64(
  base64: string,
  name: string
): Promise<Parse.File> {
  const safeName = encodeURIComponent(name || 'image.webp');
  const file = new Parse.File(safeName, {base64});
  return await file.save({useMasterKey: true});
}

async function destroyOldImage(
  id: string,
  className: string,
  attributeName: string
) {
  if (!id) return;

  const query = new Parse.Query(className);
  query.equalTo('objectId', id);
  query.include([attributeName]);
  const classObject = await query.first({useMasterKey: true});
  const oldImg = classObject?.get(attributeName);

  if (oldImg && typeof oldImg.destroy === 'function') {
    await oldImg.destroy({useMasterKey: true});
    // console.log('Old image destroyed');
  }
}

export async function handleImageLogic<T extends Parse.Object>(
  object: T,
  file: any,
  id: string | undefined,
  attributeName: string
): Promise<void> {
  const className = object.className;

  if (!file) return;

  if (!file?.image && !id) return;

  if (!file.image?.url && !file.image?.base64 && id) {
    const [error] = await catchError(
      destroyOldImage(id!, className, attributeName)
    );
    if (error) {
      console.error('Error destroying old image:', error);
    }
    return;
  }

  const imgObj = new IMG();

  // Make the image follow its parent's visibility. Prefer the parent's
  // PER-RECORD ACL when the caller has already set one (so an image inherits the
  // record's real read access, not the admin-only class default); otherwise fall
  // back to the class default template. NOTE: most cloud functions set the
  // record ACL AFTER calling handleImageLogic — for those, call `syncImageAcl`
  // from the kit right after `setACL` (and on every status transition) so the
  // image is (re)stamped with the final ACL.
  const recordACL = object.getACL();
  if (recordACL) {
    imgObj.setACL(recordACL);
  } else {
    const parentACL = Reflect.getMetadata('parse:defaultACL', object.constructor) as ClassAclTemplate | undefined;
    if (parentACL) {
      imgObj.setACL(buildACLFromTemplate(parentACL));
    }
  }

  if (file?.image?.base64 && file?.image?.name) {
    const [error] = await catchError(
      destroyOldImage(id!, className, attributeName)
    );
    if (error) {
      console.error('Error destroying old image:', error);
    }

    const [uploadError, fileUpload] = await catchError(
      createImageFromBase64(file.image.base64, file.image.name)
    );

    if (uploadError) {
      console.error('File upload failed:', uploadError);
      return;
    }

    imgObj.image = fileUpload;
    if (file.imageThumbNail) imgObj.imageThumbNail = file.imageThumbNail;
    if (file.blurHash) imgObj.blurHash = file.blurHash;
  }

  // Re-sent existing image (an included pointer, no new base64): reference it by
  // id/objectId so it is PRESERVED rather than replaced with an empty IMG. Parse
  // REST returns `objectId` on an included pointer; some callers pass `id` —
  // accept either, otherwise re-saving an unchanged image wipes it.
  const existingId = file?.id ?? file?.objectId;
  if (existingId && file?.image?.url && !file?.image?.base64) {
    imgObj.id = existingId;
  }

  object.set(attributeName, imgObj);
}

export async function handleImageArrayLogic<T extends Parse.Object>(
  object: T,
  files: any[] = [],
  id: string | undefined,
  attributeName: string
): Promise<void> {
  const className = object.className;

  const incomingIds = new Set(
    files
      .map(f => {
        // Accept id OR objectId — Parse REST returns objectId on included pointers.
        if (f && (f.id || f.objectId) && f.className === 'IMG') {
          return f.id ?? f.objectId;
        }
        if (f && f.image && (f.image.id || f.image.objectId)) {
          return f.image.id ?? f.image.objectId;
        }

        return null;
      })
      .filter(Boolean)
  );
  const newImages: IMG[] = [];

  if (id) {
    const query = new Parse.Query(className);
    query.equalTo('objectId', id);
    query.include([attributeName]);

    const existingObj = await query.first({useMasterKey: true});
    const currentImages: IMG[] = existingObj?.get(attributeName) || [];

    for (const img of currentImages) {
      if (!incomingIds.has(img.id)) {
        const [error] = await catchError(img.destroy({useMasterKey: true}));
        if (error) {
          console.error('Error destroying old image:', error);
        }
      }
    }
  }

  // Match parent object's default ACL
  const parentACL = Reflect.getMetadata('parse:defaultACL', object.constructor) as ClassAclTemplate | undefined;

  // 🖼 Process each image in the array
  for (const fileWrapper of files) {
    let imgObj = new IMG();
    if (parentACL) {
      imgObj.setACL(buildACLFromTemplate(parentACL));
    }

    if (fileWrapper && fileWrapper.image && fileWrapper.image.base64) {
      const file = fileWrapper.image;

      const [uploadError, parseFile] = await catchError(
        createImageFromBase64(file.base64, file.name)
      );
      if (uploadError) {
        console.error('File upload failed:', uploadError);
        continue;
      }

      imgObj.image = parseFile;
      if (file.imageThumbNail) imgObj.imageThumbNail = file.imageThumbNail;
      if (file.blurHash) imgObj.blurHash = file.blurHash;
      newImages.push(imgObj);
      continue;
    }

    const keepId = fileWrapper?.id ?? fileWrapper?.objectId;
    if (
      fileWrapper &&
      fileWrapper.image &&
      keepId &&
      fileWrapper.image.url &&
      !fileWrapper.image.base64
    ) {
      imgObj.id = keepId;
      newImages.push(imgObj);
      continue;
    }
  }

  object.set(attributeName, newImages);
}
