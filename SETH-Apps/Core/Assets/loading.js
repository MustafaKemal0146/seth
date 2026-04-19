/**
 * Loading States Manager
 */

class LoadingManager {
    static show(element, text = 'Yükleniyor...') {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        
        if (!element) return;
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center';
        overlay.innerHTML = `
            <div class="bg-white dark:bg-surface-dark rounded-lg p-6 shadow-xl">
                <div class="flex flex-col items-center gap-4">
                    <div class="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
                    <p class="text-gray-700 dark:text-gray-300 font-medium">${text}</p>
                </div>
            </div>
        `;
        
        element.appendChild(overlay);
        return overlay;
    }
    
    static hide(element) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        
        if (!element) return;
        
        const overlay = element.querySelector('.loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
    
    static button(button, loading = true) {
        if (typeof button === 'string') {
            button = document.querySelector(button);
        }
        
        if (!button) return;
        
        if (loading) {
            button.disabled = true;
            button.dataset.originalHTML = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin text-inherit"></i>';
        } else {
            button.disabled = false;
            if (button.dataset.originalHTML) {
                button.innerHTML = button.dataset.originalHTML;
                delete button.dataset.originalHTML;
            }
        }
    }
}

// Auto-loading for forms (yorum formu kendi loading ikonunu kullanır, hariç tut)
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('form:not([id="commentForm"])').forEach(form => {
        form.addEventListener('submit', function(e) {
            const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
            if (submitButton && !form.dataset.noGlobalLoading) {
                LoadingManager.button(submitButton, true);
            }
        });
    });
    
    // Link loading
    document.querySelectorAll('a[data-loading]').forEach(link => {
        link.addEventListener('click', function(e) {
            LoadingManager.show(document.body, link.dataset.loading || 'Yükleniyor...');
        });
    });
});

