import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ChangeLangService } from '../../../services/change-lang.service';
import { ImageCropperDialogComponent } from '../image-cropper-dialog/image-cropper-dialog.component';
import { IMG } from '../../../models/IMG';

@Component({
  selector: 'app-image-uploader',
  imports: [ButtonModule, TranslateModule],
  templateUrl: './image-uploader.component.html',
  styleUrl: './image-uploader.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dragging]': 'isDragging()',
  },
})
export class ImageUploaderComponent {
  aspectRatio = input.required<number>();
  image = input.required<IMG>();
  canDelete = input(true);

  imageChange = output<IMG>();

  private cls = inject(ChangeLangService);
  private dialogService = inject(DialogService);
  private cropperRef: DynamicDialogRef | null = null;

  dataImage = signal('');
  isDragging = signal(false);

  constructor() {
    effect(() => {
      const img = this.image();
      if (img?.image?.base64) {
        this.dataImage.set(img.image.base64);
      } else if (img?.image?.url) {
        this.dataImage.set(img.image.url);
      }
    });
  }

  onFileDropped(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files) {
      this.uploadImage(event.dataTransfer.files);
    }
    this.isDragging.set(false);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  uploadFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.jpg, .jpeg, .png, .webp';
    fileInput.addEventListener('change', (event: Event) => {
      const target = event.target as HTMLInputElement;
      if (target.files) {
        this.uploadImage(target.files);
      }
    });
    fileInput.click();
  }

  uploadImage(files: FileList): void {
    const imageFile = files.item(0);
    if (!imageFile) return;

    this.cropperRef = this.dialogService.open(
      ImageCropperDialogComponent,
      {
        header: 'Crop Image',
        data: {
          aspectRatio: this.aspectRatio(),
          imageFile: imageFile,
          format: 'webp',
          max_image_width: 400,
          maintainAspectRatio: true,
        },
        width: '30%',
        style: {
          direction: this.cls.currentDirection(),
        },
        modal: true,
        closable: true,
      }
    );

    this.cropperRef?.onClose.subscribe((base64Image: string) => {
      if (base64Image) {
        const updatedImage: IMG = {
          ...this.image(),
          image: { base64: base64Image, name: 'image.webp' },
        };
        this.dataImage.set(base64Image);
        this.imageChange.emit(updatedImage);
      }
    });
  }

  removeImage(): void {
    const newImage: IMG = { image: undefined };
    this.dataImage.set('');
    this.imageChange.emit(newImage);
  }
}
