import { Router, Request, Response } from 'express';
import {
    verifyTelebirr,
    TelebirrVerificationError,
    telebirrErrorHttpStatus,
} from '../services/verifyTelebirr';
import logger from '../utils/logger';

const router = Router();

interface VerifyTelebirrRequestBody {
    reference: string;
}

router.post<{}, {}, VerifyTelebirrRequestBody>(
    '/',
    async (req: Request<{}, {}, VerifyTelebirrRequestBody>, res: Response): Promise<void> => {
        const { reference } = req.body;

        if (!reference) {
            res.status(400).json({ success: false, error: 'Missing reference.' });
            return;
        }

        try {
            const result = await verifyTelebirr(reference);
            res.json({ success: true, data: result });
        } catch (err: any) {
            logger.error('Telebirr verification error:', err);

            if (err instanceof TelebirrVerificationError) {
                res.status(telebirrErrorHttpStatus(err.code)).json({
                    success: false,
                    error: err.message,
                    code: err.code,
                    details: err.details,
                });
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Server error verifying Telebirr receipt.',
                message: err instanceof Error ? err.message : 'Unknown error',
            });
        }
    }
);

export default router;
