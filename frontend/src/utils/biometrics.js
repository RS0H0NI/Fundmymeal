/**
 * Utility to simulate biometric identification without storing actual image data.
 * It takes an image file, extracts pixel data, and creates a SHA-256 hash.
 */

export const generateBiometricHash = async (imageFile) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            const img = new Image();
            img.onload = async () => {
                try {
                    // Draw image to canvas to extract raw pixel data
                    const canvas = document.createElement('canvas');
                    // Scale down to a fixed size to normalize slight differences, 
                    // but for this demo identical files will produce identical hashes anyway.
                    canvas.width = 100;
                    canvas.height = 100;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const pixelBuffer = imageData.data.buffer; // Raw pixel bytes

                    // Hash the pixel data using Web Crypto API
                    const hashBuffer = await crypto.subtle.digest('SHA-256', pixelBuffer);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                    resolve(hashHex);
                } catch (err) {
                    reject(err);
                }
            };

            img.onerror = () => reject(new Error('Failed to load image.'));
            img.src = event.target.result;
        };

        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(imageFile);
    });
};
