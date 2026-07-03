import dotenv from 'dotenv';
import ReleaseUpdater from './release_updater.js';
import config from './config.js';

dotenv.config();

async function main() {
    try {
        // 서브모듈 모드: 서브모듈 자체의 버전을 추적
        // 레포지토리는 고정: bnam91/module_update_auto
        const owner = "bnam91";
        const repo = "module_update_auto";
        
        // config.js에서 서브모듈 버전 파일 경로 가져오기
        const versionFile = config.submoduleVersionFile;
        
        console.log(`프로젝트 루트: ${config.projectRoot}`);
        console.log(`서브모듈 경로: ${config.submodulePath}`);
        console.log(`서브모듈 버전 파일: ${versionFile}`);
        
        // 서브모듈 모드로 업데이터 생성
        const updater = new ReleaseUpdater(owner, repo, versionFile);
        
        // 방법 4: 기존 방식 (하위 호환성)
        // const updater = new ReleaseUpdater(owner, repo);
        
        const updateSuccess = await updater.updateToLatest();
        
        if (updateSuccess) {
            console.log("프로그램을 실행합니다...");
        } else {
            console.log("업데이트 실패, 이전 버전으로 계속 진행합니다...");
        }
        
        // 업데이트 결과와 상관없이 실행되는 코드
        runProgram();
        
    } catch (error) {
        console.error(`예상치 못한 오류 발생: ${error.message}`);
        // 중요한 예외는 로깅하거나 오류 보고 시스템에 전송할 수 있음
    }
}

function runProgram() {
    // 실제 프로그램 코드를 별도 함수로 분리
    console.log("Hello, GitHub!");
}

main();