import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({
    description: 'Google ID token issued by Google Identity Services SDK',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Google ID token is required' })
  idToken!: string;

  @ApiPropertyOptional({
    description: 'Optional referral code if registering via referral link',
    example: 'NUTS-ABC123',
  })
  @IsOptional()
  @IsString()
  referralCode?: string;
}
