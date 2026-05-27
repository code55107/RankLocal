import { IsEmail, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAuditDto {
  @ApiProperty({ example: "Joe's Pizza Palace" })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  businessName!: string;

  @ApiProperty({ example: 'https://joespizzapalace.com' })
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  websiteUrl!: string;

  @ApiProperty({ example: 'Austin, TX' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location!: string;

  @ApiProperty({ example: 'joe@joespizzapalace.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ description: 'Comma-separated competitor names (free-form)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  competitors?: string;
}
