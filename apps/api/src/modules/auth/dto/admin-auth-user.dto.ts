import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminAuthUserDto {
  @ApiProperty({
    description: 'Unique identifier of the admin user',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Email address of the admin user',
    example: 'admin@example.com',
  })
  email!: string;

  @ApiPropertyOptional({
    description: 'First name of the admin user',
    example: 'Admin',
    nullable: true,
  })
  firstName!: string | null;

  @ApiPropertyOptional({
    description: 'Last name of the admin user',
    example: 'User',
    nullable: true,
  })
  lastName!: string | null;
}
