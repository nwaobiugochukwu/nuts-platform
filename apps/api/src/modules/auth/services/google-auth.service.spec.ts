import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service';

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let mockConfigService: any;
  let mockVerifyIdToken: jest.Mock;

  beforeEach(() => {
    mockConfigService = {
      get: jest
        .fn()
        .mockReturnValue('mock-google-client-id.apps.googleusercontent.com'),
    };

    service = new GoogleAuthService(mockConfigService);

    // Mock OAuth2Client.verifyIdToken on the service instance
    mockVerifyIdToken = jest.fn();
    (service as any).oauthClient = {
      verifyIdToken: mockVerifyIdToken,
    };
  });

  it('should throw BadRequestException if idToken is empty', async () => {
    await expect(service.verifyIdToken('')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw UnauthorizedException if Google fails to verify the token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));

    await expect(service.verifyIdToken('invalid-jwt')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if issuer is not Google', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        iss: 'https://evil.com',
        sub: '12345',
        email: 'attacker@evil.com',
        email_verified: true,
      }),
    });

    await expect(service.verifyIdToken('fake-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw BadRequestException if Google account has no email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        sub: '12345',
        email_verified: true,
      }),
    });

    await expect(service.verifyIdToken('token-without-email')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw UnauthorizedException if email is not verified by Google', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        sub: '12345',
        email: 'unverified@example.com',
        email_verified: false,
      }),
    });

    await expect(service.verifyIdToken('unverified-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should successfully return payload when token is valid and email is verified', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        iss: 'accounts.google.com',
        sub: 'google-sub-12345',
        email: 'Verified.User@Example.com ',
        email_verified: true,
        given_name: 'Verified',
        family_name: 'User',
        picture: 'https://lh3.googleusercontent.com/avatar.jpg',
      }),
    });

    const result = await service.verifyIdToken('valid-google-id-token');

    expect(result).toEqual({
      googleId: 'google-sub-12345',
      email: 'verified.user@example.com',
      firstName: 'Verified',
      lastName: 'User',
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
      emailVerified: true,
    });
  });
});
