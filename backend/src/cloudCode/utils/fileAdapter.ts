// MyCustomFileAdapter.ts

// Import necessary modules from Node.js and Express
import {Request, Response} from 'express';
import * as fs from 'fs'; // File system module for interacting with the file system
import Parse from 'parse';
import * as path from 'path'; // Path module for handling file and directory paths
import {catchError} from '@90soft/parse-server-kit';
require('dotenv').config();

// Define an interface for the adapter options
interface FileAdapterOptions {
  filesDir?: string; // Optional: Directory where files will be stored
}

// Define an interface for the Parse Server configuration object used in getFileLocation
interface ParseServerConfig {
  mount: string; // The mount path of your Parse Server (e.g., '/parse')
  applicationId: string; // The application ID of your Parse Server
}

// Define the custom file adapter class
class FileAdapter /* implements FilesAdapter */ {
  private filesDir: string; // Directory where files are stored

  // Constructor to initialize the file adapter with options
  constructor(options: FileAdapterOptions = {}) {
    // Set the files directory, defaulting to a 'files' directory in the current directory
    this.filesDir = options.filesDir || path.resolve(__dirname, 'files');
  }

  // Method to create a file
  async createFile(
    filename: string, // Name of the file to create
    data: Buffer, // File data as a Buffer
    contentType?: string // Optional: MIME type of the file
  ): Promise<void> {
    // Get the full local file path for the filename

    this.validateFilename(filename);

    const filePath = this._getLocalFilePath(filename);

    // Ensure the directory exists, creating it recursively if necessary
    await fs.promises.mkdir(path.dirname(filePath), {recursive: true});

    // Write the file data to the file system
    await fs.promises.writeFile(filePath, data as any);
  }

  // Method to delete a file
  async deleteFile(filename: string): Promise<void> {
    // Get the full local file path for the filename
    const filePath = this._getLocalFilePath(filename);

    console.log('Delete File');
    const [err] = await catchError(fs.promises.unlink(filePath));
    if (err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // Method to retrieve file data
  async getFileData(filename: string): Promise<Buffer> {
    // Get the full local file path for the filename

    const filePath = this._getLocalFilePath(filename);

    // Read and return the file data as a Buffer
    return fs.promises.readFile(filePath);
  }

  // Method to get the public URL for a file
  getFileLocation(config: ParseServerConfig, filename: string): string {
    // Construct and return the file URL using the server mount path and application ID
    return `${config.mount}/files/${config.applicationId}/${encodeURIComponent(
      filename
    )}`;
  }

  // Method to validate the filename
  validateFilename(filename: string): Parse.Error | null {
    if (filename.length > 128) {
      return new Parse.Error(
        Parse.Error.INVALID_FILE_NAME,
        'Filename too long.'
      );
    }

    const regx =
      /^[_\u0600-\u06FF\u0750-\u077F\u08A0-\u08FFa-zA-Z0-9][\u0600-\u06FF\u0750-\u077F\u08A0-\u08FFa-zA-Z0-9@. ~_-]*$/;
    if (!filename.match(regx)) {
      // return new Parse.Error(
      //   Parse.Error.INVALID_FILE_NAME,
      //   "Filename contains invalid characters."
      // );
    }
    return null;
  }
  // Method to handle file streaming, including handling of Range requests
  async handleFileStream(
    filename: string, // Name of the file to stream
    req: Request, // Express request object
    res: Response, // Express response object
    contentType?: string // Optional: MIME type of the file
  ): Promise<void> {
    // Get the full local file path for the filename
    const filePath = this._getLocalFilePath(filename);

    const [statErr, stats] = await catchError(fs.promises.stat(filePath));
    if (statErr || !stats) {
      res.status(404).send('File not found');
      return;
    }

    // Check if the path is a file
    if (!stats.isFile()) {
      // If not a file, send a 404 Not Found response
      res.status(404).send('File not found');
      return;
    }

    const fileSize = stats.size; // Size of the file in bytes
    const range = req.headers.range; // Get the Range header from the request

    if (range) {
      // If a Range header is present, handle partial content

      // Parse the Range header to get start and end positions
      const parts = range.replace(/bytes=/, '').split('-');
      let start = parseInt(parts[0], 10); // Start byte position
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1; // End byte position

      // Validate the range values
      if (
        isNaN(start) || // Start is not a number
        isNaN(end) || // End is not a number
        start > end || // Start is after end
        start >= fileSize || // Start is beyond the file size
        end >= fileSize // End is beyond the file size
      ) {
        // If invalid range, send a 416 Range Not Satisfiable response
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`, // Required in 416 responses
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1; // Calculate the size of the chunk to send

      // Create a read stream for the specified byte range
      const fileStream = fs.createReadStream(filePath, {start, end});

      // Set response headers for partial content
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`, // Content-Range header
        'Accept-Ranges': 'bytes', // Indicate that byte ranges are accepted
        'Content-Length': chunkSize, // Length of the content being sent
        'Content-Type': contentType || this._getContentType(filename), // MIME type
      });

      // Pipe the file stream to the response
      fileStream.pipe(res);
    } else {
      // If no Range header, send the entire file

      // Set response headers for full content
      res.writeHead(200, {
        'Content-Length': fileSize, // Total size of the file
        'Content-Type': contentType || this._getContentType(filename), // MIME type
      });

      // Create a read stream for the entire file and pipe it to the response
      fs.createReadStream(filePath).pipe(res);
    }
  }
  // Private method to get the full local file path for a given filename
  private _getLocalFilePath(filename: string): string {
    // Get the application ID from environment variables, defaulting to 'default'
    const appId = process.env.appId || 'default';

    // Construct the file path by joining the files directory, app ID, and filename
    filename = decodeURIComponent(filename);
    return path.join(this.filesDir, appId, filename);
  }

  // Private method to determine the content type based on the file extension
  private _getContentType(filename: string): string {
    // Get the file extension in lowercase
    const ext = path.extname(filename).toLowerCase();

    // Map of file extensions to MIME types
    const mimeTypes: {[key: string]: string} = {
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.pdf': 'application/pdf',
      // Add other content types as needed
    };

    // Return the corresponding MIME type, or 'application/octet-stream' if unknown
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

// Export the custom file adapter class as the default export
export default FileAdapter;
