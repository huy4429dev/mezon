import { ActionEmitEvent, CheckIcon } from '@mezon/mobile-components';
import { Colors, size, useTheme } from '@mezon/mobile-ui';
import { emojiRecentActions, selectCurrentClan, useAppSelector } from '@mezon/store-mobile';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { DeviceEventEmitter, Text, TouchableOpacity, View } from 'react-native';
import FastImage from 'react-native-fast-image';
import Toast from 'react-native-toast-message';
import { useDispatch } from 'react-redux';
import MezonConfirm from '../../../../../../componentUI/MezonConfirm';
import MezonIconCDN from '../../../../../../componentUI/MezonIconCDN';
import { IconCDN } from '../../../../../../constants/icon_cdn';
import RenderAudioItem from './SoundStickerItem';
import { style } from './styles';

interface ISticker {
	stickerList: any[];
	categoryName: string;
	onClickSticker: (sticker: any) => void;
	isAudio?: boolean;
}

export default memo(function Sticker({ stickerList, categoryName, onClickSticker, isAudio }: ISticker) {
	const { themeValue } = useTheme();
	const styles = style(themeValue);
	const stickersListByCategoryName = stickerList.filter((sticker) => sticker.type === categoryName);
	const currentClan = useAppSelector(selectCurrentClan);
	const { t } = useTranslation(['token']);
	const dispatch = useDispatch();

	const onBuySticker = async (sticker: any) => {
		try {
			if (sticker.id) {
				const resp = await dispatch(emojiRecentActions.buyItemForSale({ id: sticker?.id, type: 1 }));
				if (!resp?.type?.includes('rejected')) {
					Toast.show({
						type: 'success',
						props: {
							text2: 'Buy item successfully!',
							leadingIcon: <CheckIcon color={Colors.green} width={30} height={17} />
						}
					});
					DeviceEventEmitter.emit(ActionEmitEvent.ON_TRIGGER_MODAL, { isDismiss: true });
				} else {
					Toast.show({ type: 'error', text1: 'Failed to buy item.' });
				}
			}
		} catch (error) {
			console.error('Error buying sticker:', error);
			Toast.show({ type: 'error', text1: 'Failed to buy item.' });
		}
	};

	const onPress = (sticker: any) => {
		if (sticker?.forSale && !sticker.url) {
			const data = {
				children: (
					<MezonConfirm
						onConfirm={() => onBuySticker(sticker)}
						title={t('unlockItemTitle')}
						content={t('unlockItemDes')}
						confirmText={t('confirmUnlock')}
					/>
				)
			};
			DeviceEventEmitter.emit(ActionEmitEvent.ON_TRIGGER_MODAL, { isDismiss: false, data });
		} else {
			onClickSticker(sticker);
		}
	};

	return (
		<View style={styles.session} key={`${categoryName}_stickers-parent`}>
			<Text style={styles.sessionTitle}>{categoryName !== 'custom' ? categoryName : currentClan?.clan_name}</Text>
			<View style={styles.sessionContent}>
				{stickersListByCategoryName.length > 0 &&
					stickersListByCategoryName.map((sticker, index) => (
						<TouchableOpacity
							key={`${index}_sticker`}
							onPress={() => onPress(sticker)}
							style={isAudio ? styles.audioContent : styles.content}
						>
							{isAudio ? (
								<>
									<RenderAudioItem audioURL={sticker?.url} />
									<Text style={styles.soundName} numberOfLines={1}>
										{sticker?.name}
									</Text>
								</>
							) : (
								<FastImage
									source={{
										uri: sticker.url ? sticker.url : `${process.env.NX_BASE_IMG_URL}/stickers/` + sticker.id + `.webp`,
										cache: FastImage.cacheControl.immutable,
										priority: FastImage.priority.high
									}}
									style={{ height: '100%', width: '100%' }}
								/>
							)}
							{sticker?.forSale && !sticker.url && (
								<View style={styles.wrapperIconLocked}>
									<MezonIconCDN icon={IconCDN.lockIcon} color={'#e1e1e1'} width={size.s_30} height={size.s_30} />
								</View>
							)}
						</TouchableOpacity>
					))}
			</View>
		</View>
	);
});
