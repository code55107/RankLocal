import { Global, Module } from '@nestjs/common';
import { GooglePlacesService } from './google-places.service';
import { GooglePagespeedService } from './google-pagespeed.service';
import { AnthropicService } from './anthropic.service';

@Global()
@Module({
  providers: [GooglePlacesService, GooglePagespeedService, AnthropicService],
  exports: [GooglePlacesService, GooglePagespeedService, AnthropicService],
})
export class ExternalModule {}
