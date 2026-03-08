import React from 'react';
import { render } from '@testing-library/react';
import { Modal, ModalContent, ModalHeader, ModalTitle } from './src/components/ui/Modal';
import { describe, it, expect, vi } from 'vitest';

describe('Modal test', () => {
    it('renders successfully without warning', () => {
        const { unmount } = render(
            <Modal open={true} onOpenChange={() => {}}>
                <ModalContent aria-describedby="test-desc">
                    <ModalHeader>
                        <ModalTitle>Test Modal</ModalTitle>
                    </ModalHeader>
                    <div id="test-desc">This is a test description</div>
                </ModalContent>
            </Modal>
        );
        unmount();
    })
})
