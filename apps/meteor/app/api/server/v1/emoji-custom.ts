import { Media } from '@rocket.chat/core-services';
import { EmojiCustom } from '@rocket.chat/models';
import { Meteor } from 'meteor/meteor';

import { SystemLogger } from '../../../../server/lib/logger/system';
import { insertOrUpdateEmoji } from '../../../emoji-custom/server/lib/insertOrUpdateEmoji';
import { uploadEmojiCustomWithBuffer } from '../../../emoji-custom/server/lib/uploadEmojiCustom';
import { settings } from '../../../settings/server';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';
import { findEmojisCustom } from '../lib/emoji-custom';
import { getUploadFormData } from '../lib/getUploadFormData';

API.v1.addRoute(
	'emoji-custom.list',
	{ authRequired: true },
	{
		async get() {
			const { query } = await this.parseJsonQuery();
			const { updatedSince } = this.queryParams;
			if (updatedSince) {
				const updatedSinceDate = new Date(updatedSince);
				if (isNaN(Date.parse(updatedSince))) {
					throw new Meteor.Error('error-roomId-param-invalid', 'The "updatedSince" query parameter must be a valid date.');
				}
				const [update, remove] = await Promise.all([
					EmojiCustom.find({ ...query, _updatedAt: { $gt: updatedSinceDate } }).toArray(),
					EmojiCustom.trashFindDeletedAfter(updatedSinceDate).toArray(),
				]);
				return API.v1.success({
					emojis: {
						update,
						remove,
					},
				});
			}

			return API.v1.success({
				emojis: {
					update: await EmojiCustom.find(query).toArray(),
					remove: [],
				},
			});
		},
	},
);

API.v1.addRoute(
	'emoji-custom.all',
	{ authRequired: true },
	{
		async get() {
			const { offset, count } = await getPaginationItems(this.queryParams);
			const { sort, query } = await this.parseJsonQuery();

			return API.v1.success(
				await findEmojisCustom({
					query,
					pagination: {
						offset,
						count,
						sort,
					},
				}),
			);
		},
	},
);

API.v1.addRoute(
	'emoji-custom.create',
	{ authRequired: true },
	{
		async post() {
			const emoji = await getUploadFormData(
				{
					request: this.request,
				},
				{ field: 'emoji', sizeLimit: settings.get('FileUpload_MaxFileSize') },
			);

			const { fields, fileBuffer, mimetype } = emoji;

			const isUploadable = await Media.isImage(fileBuffer);
			if (!isUploadable) {
				throw new Meteor.Error('emoji-is-not-image', "Emoji file provided cannot be uploaded since it's not an image");
			}

			const [, extension] = mimetype.split('/');
			fields.extension = extension;

			try {
				await Meteor.callAsync('insertOrUpdateEmoji', {
					...fields,
					newFile: true,
					aliases: fields.aliases || '',
				});
				await Meteor.callAsync('uploadEmojiCustom', fileBuffer, mimetype, {
					...fields,
					newFile: true,
					aliases: fields.aliases || '',
				});
			} catch (e) {
				SystemLogger.error(e);
				return API.v1.failure();
			}

			return API.v1.success();
		},
	},
);

API.v1.addRoute(
	'emoji-custom.update',
	{ authRequired: true },
	{
		async post() {
			const emoji = await getUploadFormData(
				{
					request: this.request,
				},
				{ field: 'emoji', sizeLimit: settings.get('FileUpload_MaxFileSize'), optional: true },
			);

			const { fields, fileBuffer, mimetype } = emoji;

			if (!fields._id) {
				throw new Meteor.Error('The required "_id" query param is missing.');
			}

			const emojiToUpdate = await EmojiCustom.findOneById(fields._id);
			if (!emojiToUpdate) {
				throw new Meteor.Error('Emoji not found.');
			}

			fields.previousName = emojiToUpdate.name;
			fields.previousExtension = emojiToUpdate.extension;
			fields.aliases = fields.aliases || '';

			let newFile = false;

			if (fileBuffer?.length) {
				newFile = true;
				const isUploadable = await Media.isImage(fileBuffer);
				if (!isUploadable) {
					throw new Meteor.Error('emoji-is-not-image', "Emoji file provided cannot be uploaded since it's not an image");
				}

				const [, extension] = mimetype.split('/');
				fields.extension = extension;
			} else {
				fields.extension = emojiToUpdate.extension;
			}

			const emojiData = {
				name: fields.name,
				_id: fields._id,
				aliases: fields.aliases,
				extension: fields.extension,
				previousName: fields.previousName,
				previousExtension: fields.previousExtension,
				newFile,
			};

			const updatedEmojiData = await insertOrUpdateEmoji(this.userId, emojiData);
			if (newFile && fileBuffer) {
				await uploadEmojiCustomWithBuffer(this.userId, fileBuffer, mimetype, updatedEmojiData);
			}
			return API.v1.success();
		},
	},
);

API.v1.addRoute(
	'emoji-custom.delete',
	{ authRequired: true },
	{
		async post() {
			const { emojiId } = this.bodyParams;
			if (!emojiId) {
				return API.v1.failure('The "emojiId" params is required!');
			}

			await Meteor.callAsync('deleteEmojiCustom', emojiId);

			return API.v1.success();
		},
	},
);
