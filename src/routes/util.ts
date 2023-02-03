import { z } from 'zod';
import { zfd } from 'zod-form-data';
import { PAGE_PARAM, SEARCH_PARAM, SOURCE_PARAM, TYPE_PARAM } from '../library/constants';

export const filterSchema = zfd.formData({
	[SEARCH_PARAM]: zfd.text(z.string().default('')),
	[PAGE_PARAM]: zfd.numeric(z.number().min(0)).default(1),
	[TYPE_PARAM]: zfd.text(z.string().default('artist')),
	[SOURCE_PARAM]: zfd.text(z.string()).default("0")
});
