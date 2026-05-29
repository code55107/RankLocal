import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({ example: '4/0AX4XfWj...' })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  code!: string;

  @ApiProperty({ example: 'http://localhost:3000/api/auth/google/callback' })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  redirectUri!: string;
}
