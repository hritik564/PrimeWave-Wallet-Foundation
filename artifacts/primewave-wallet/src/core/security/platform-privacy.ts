import { Platform } from 'react-native';
import type { ScreenPrivacyController, SensitiveScreen } from './privacy';

class ExpoScreenPrivacyController implements ScreenPrivacyController {
  private async setProtected(enabled: boolean): Promise<void> {
    if (Platform.OS === 'web') {
      return;
    }
    try {
      const ScreenCapture = await import('expo-screen-capture');
      if (enabled) {
        await ScreenCapture.preventScreenCaptureAsync('primewave-sensitive');
      } else {
        await ScreenCapture.allowScreenCaptureAsync('primewave-sensitive');
      }
    } catch {
      // Screen privacy is best-effort and platform-dependent.
    }
  }

  async enterSensitiveScreen(_screen: SensitiveScreen): Promise<void> {
    await this.setProtected(true);
  }

  async exitSensitiveScreen(_screen: SensitiveScreen): Promise<void> {
    await this.setProtected(false);
  }

  async maskSensitiveContent(): Promise<void> {
    await this.setProtected(true);
  }

  async restoreSensitiveContent(): Promise<void> {
    await this.setProtected(false);
  }
}

export const screenPrivacyController = new ExpoScreenPrivacyController();