import { SetMetadata } from '@nestjs/common';

export const TRACK_PRODUCT_VIEW_KEY = 'track_product_view';

/**
 * Decorator to mark a route for automatic product view tracking.
 */
export const TrackProductView = () => SetMetadata(TRACK_PRODUCT_VIEW_KEY, true);
