import React from 'react';
import { render } from '@testing-library/react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from './src/components/ui/Modal';
import { describe, it, expect, vi } from 'vitest';

describe('Modal test', () => {
    it('renders successfully without warning', () => {
        const { unmount } = render(
            <Modal open={true} onOpenChange={() => {}}>
                <ModalContent aria-describedby={undefined}>
                    <ModalHeader>
                        <ModalTitle>Test Modal</ModalTitle>
                    </ModalHeader>
                    <ModalDescription className="sr-only">Hidden Description</ModalDescription>
                </ModalContent>
            </Modal>
        );
        unmount();
    })
})
