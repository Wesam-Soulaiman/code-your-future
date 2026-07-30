import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ImageCropperComponent, ImageCroppedEvent, OutputFormat } from 'ngx-image-cropper';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'app-image-cropper-dialog',
  templateUrl: './image-cropper-dialog.component.html',
  styleUrls: ['./image-cropper-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImageCropperComponent, TranslateModule, ButtonModule],
})
export class ImageCropperDialogComponent {
  private dialogConfig = inject(DynamicDialogConfig);
  private dialogRef = inject(DynamicDialogRef);

  imageCropper = viewChild(ImageCropperComponent);

  croppedImage = signal('');

  config = this.dialogConfig.data as {
    aspectRatio: number;
    imageBase64?: string;
    format: OutputFormat;
    max_image_width: number;
    maintainAspectRatio: boolean;
    imageFile?: File;
  };

  imageCropped(event: ImageCroppedEvent): void {
    this.croppedImage.set(event.base64 ?? '');
  }

  doneCropping(): void {
    this.dialogRef.close(this.croppedImage());
  }

  close(): void {
    this.dialogRef.close();
  }
}
