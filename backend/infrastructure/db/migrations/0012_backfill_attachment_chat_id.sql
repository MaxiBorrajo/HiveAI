UPDATE `attachments`
SET `chatId` = (SELECT `chatId` FROM `messages` WHERE `messages`.`id` = `attachments`.`messageId`)
WHERE `chatId` IS NULL AND `messageId` IS NOT NULL;
